"""WSGI application: JSON API + static single-page frontend.

Serve with any WSGI server, e.g. `gunicorn -w 4 'app.web:application'`,
or `python run.py` for local development.
"""
from __future__ import annotations

import csv
import io
import json
import mimetypes
import re
import sqlite3
import traceback
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from http.cookies import SimpleCookie

from . import billing, config, db, engine, mpesa, notify
from .security import (RateLimiter, hash_password, hash_reset_code, hash_token, new_reset_code, new_token,
                       verify_password, verify_reset_code)

STATIC_DIR = config.BASE_DIR / "static"
MAX_BODY = 64 * 1024
COOKIE = "pf_session"

login_limiter = RateLimiter(limit=10, window_seconds=15 * 60)
signup_limiter = RateLimiter(limit=5, window_seconds=60 * 60)
pay_limiter = RateLimiter(limit=5, window_seconds=10 * 60)
reset_ip_limiter = RateLimiter(limit=10, window_seconds=60 * 60)
reset_email_limiter = RateLimiter(limit=3, window_seconds=60 * 60)
reset_confirm_limiter = RateLimiter(limit=20, window_seconds=15 * 60)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

SECURITY_HEADERS = [
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
    ("Content-Security-Policy",
     "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
     "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"),
]


class HTTPError(Exception):
    def __init__(self, status: int, message: str, **extra):
        super().__init__(message)
        self.status = status
        self.message = message
        self.extra = extra


STATUS_TEXT = {200: "OK", 201: "Created", 204: "No Content", 400: "Bad Request", 401: "Unauthorized",
               402: "Payment Required", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed",
               409: "Conflict", 413: "Payload Too Large", 429: "Too Many Requests", 500: "Internal Server Error",
               502: "Bad Gateway"}


# --------------------------------------------------------------------------- request helpers

class Request:
    def __init__(self, environ: dict, conn: sqlite3.Connection):
        self.environ = environ
        self.conn = conn
        self.method = environ["REQUEST_METHOD"].upper()
        self.path = environ.get("PATH_INFO", "/") or "/"
        self.query = environ.get("QUERY_STRING", "")
        self.set_cookies: list[str] = []
        self._user: sqlite3.Row | None | bool = False
        cookie = SimpleCookie(environ.get("HTTP_COOKIE", ""))
        self.session_token = cookie[COOKIE].value if COOKIE in cookie else None

    @property
    def ip(self) -> str:
        fwd = self.environ.get("HTTP_X_FORWARDED_FOR", "")
        return fwd.split(",")[0].strip() if fwd else self.environ.get("REMOTE_ADDR", "?")

    def json(self) -> dict:
        try:
            length = int(self.environ.get("CONTENT_LENGTH") or 0)
        except ValueError:
            length = 0
        if length > MAX_BODY:
            raise HTTPError(413, "Request too large.")
        raw = self.environ["wsgi.input"].read(length) if length else b""
        if not raw:
            return {}
        try:
            data = json.loads(raw)
        except ValueError:
            raise HTTPError(400, "Invalid JSON.")
        if not isinstance(data, dict):
            raise HTTPError(400, "Expected a JSON object.")
        return data

    @property
    def user(self) -> sqlite3.Row | None:
        if self._user is False:
            self._user = None
            if self.session_token:
                row = self.conn.execute(
                    "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
                    "WHERE s.token_hash=? AND s.expires_at > ?",
                    (hash_token(self.session_token), config.now().isoformat()),
                ).fetchone()
                self._user = row
        return self._user  # type: ignore[return-value]

    def require_user(self) -> sqlite3.Row:
        if not self.user:
            raise HTTPError(401, "Please log in.")
        return self.user

    def require_active(self) -> sqlite3.Row:
        user = self.require_user()
        if not billing.status(user)["active"]:
            raise HTTPError(402, "Your subscription has expired. Renew with M-Pesa to keep editing.", code="subscription_expired")
        return user


def money(value, field: str = "amount") -> int:
    """KES amount (number or string, commas allowed) -> integer cents."""
    if value is None or value == "":
        return 0
    try:
        d = Decimal(str(value).replace(",", "").strip())
    except InvalidOperation:
        raise HTTPError(400, f"{field.capitalize()} must be a number.")
    if not d.is_finite() or abs(d) > Decimal("1e11"):
        raise HTTPError(400, f"{field.capitalize()} is out of range.")
    return int((d * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def opt_date(value, field: str) -> str | None:
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value)).isoformat()
    except ValueError:
        raise HTTPError(400, f"{field} must be a date (YYYY-MM-DD).")


def text(value, field: str, max_len: int = 200, required: bool = False) -> str:
    s = str(value or "").strip()
    if required and not s:
        raise HTTPError(400, f"{field} is required.")
    if len(s) > max_len:
        raise HTTPError(400, f"{field} is too long (max {max_len}).")
    return s


def int_in(value, field: str, lo: int, hi: int, default: int = 0) -> int:
    if value in (None, ""):
        return default
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise HTTPError(400, f"{field} must be a whole number.")
    if not lo <= n <= hi:
        raise HTTPError(400, f"{field} must be between {lo} and {hi}.")
    return n


def stamp() -> str:
    return config.now().isoformat(timespec="seconds")


# --------------------------------------------------------------------------- serializers

def user_json(u: sqlite3.Row) -> dict:
    return {"id": u["id"], "name": u["name"], "email": u["email"], "phone": u["phone"] or "",
            "is_admin": bool(u["is_admin"]), "subscription": billing.status(u)}


def account_json(a: sqlite3.Row) -> dict:
    return {"id": a["id"], "name": a["name"], "details": a["details"], "balance": a["balance"] / 100,
            "include_in_total": bool(a["include_in_total"]), "sort": a["sort"]}


def item_json(i: sqlite3.Row) -> dict:
    return {"id": i["id"], "name": i["name"], "amount": i["amount"] / 100, "every_days": i["every_days"],
            "value_date": i["value_date"], "end_date": i["end_date"], "tie_to": i["tie_to"],
            "done": bool(i["done"]), "account_id": i["account_id"], "note": i["note"], "sort": i["sort"]}


def payment_json(p: sqlite3.Row) -> dict:
    return {"id": p["id"], "plan": p["plan"], "amount": p["amount"], "phone": p["phone"], "status": p["status"],
            "result_desc": p["result_desc"] or "", "receipt": p["receipt"] or "", "created_at": p["created_at"]}


def to_date(s: str | None) -> date | None:
    return date.fromisoformat(s) if s else None


def build_projection(accounts: list[sqlite3.Row], items: list[sqlite3.Row], horizon: int) -> dict:
    p = engine.project(
        [engine.Account(a["id"], a["name"], a["balance"], bool(a["include_in_total"])) for a in accounts],
        [engine.Item(i["id"], i["name"], i["amount"], i["every_days"], to_date(i["value_date"]),
                     to_date(i["end_date"]), i["tie_to"], bool(i["done"]), i["account_id"]) for i in items],
        config.today(), horizon,
    )
    c = lambda v: v / 100  # noqa: E731
    return {
        "today": p.today.isoformat(),
        "horizon": p.horizon,
        "opening_balance": c(p.opening_balance),
        "closing_balance": c(p.closing_balance),
        "total_in": c(p.total_in),
        "total_out": c(p.total_out),
        "net_flow": c(p.net_flow),
        "lowest_balance": c(p.lowest_balance),
        "lowest_date": p.lowest_date.isoformat(),
        "first_negative_date": p.first_negative_date.isoformat() if p.first_negative_date else None,
        "effective_dates": {str(k): v.isoformat() for k, v in p.effective_dates.items()},
        "account_closing": {("none" if k is None else str(k)): c(v) for k, v in p.account_closing.items()},
        "days": [{"date": d.date.isoformat(), "net": c(d.net), "balance": c(d.balance),
                  "flows": {str(k): c(v) for k, v in d.flows.items()}} for d in p.days],
    }


# --------------------------------------------------------------------------- ownership lookups

def own_budget(req: Request, budget_id: int) -> sqlite3.Row:
    b = req.conn.execute("SELECT * FROM budgets WHERE id=? AND user_id=?", (budget_id, req.require_user()["id"])).fetchone()
    if not b:
        raise HTTPError(404, "Budget not found.")
    return b


def own_row(req: Request, table: str, row_id: int) -> sqlite3.Row:
    assert table in ("accounts", "items")
    row = req.conn.execute(
        f"SELECT t.* FROM {table} t JOIN budgets b ON b.id = t.budget_id WHERE t.id=? AND b.user_id=?",
        (row_id, req.require_user()["id"]),
    ).fetchone()
    if not row:
        raise HTTPError(404, "Not found.")
    return row


def budget_payload(req: Request, b: sqlite3.Row) -> dict:
    accounts = req.conn.execute("SELECT * FROM accounts WHERE budget_id=? ORDER BY sort, id", (b["id"],)).fetchall()
    items = req.conn.execute("SELECT * FROM items WHERE budget_id=? ORDER BY sort, id", (b["id"],)).fetchall()
    return {
        "budget": {"id": b["id"], "name": b["name"], "horizon_days": b["horizon_days"]},
        "accounts": [account_json(a) for a in accounts],
        "items": [item_json(i) for i in items],
        "projection": build_projection(accounts, items, b["horizon_days"]),
    }


# --------------------------------------------------------------------------- auth

def start_session(req: Request, user_id: int) -> None:
    token = new_token()
    expires = config.now() + timedelta(days=config.SESSION_DAYS)
    req.conn.execute("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)",
                     (hash_token(token), user_id, expires.isoformat(), stamp()))
    req.conn.execute("DELETE FROM sessions WHERE expires_at < ?", (config.now().isoformat(),))
    set_cookie(req, token, config.SESSION_DAYS * 86400)


def set_cookie(req: Request, value: str, max_age: int) -> None:
    parts = [f"{COOKIE}={value}", "Path=/", "HttpOnly", "SameSite=Lax", f"Max-Age={max_age}"]
    if config.COOKIE_SECURE:
        parts.append("Secure")
    req.set_cookies.append("; ".join(parts))


def seed_budget(conn: sqlite3.Connection, user_id: int) -> None:
    t = config.today()
    cur = conn.execute("INSERT INTO budgets (user_id, name, horizon_days, created_at) VALUES (?,?,?,?)",
                       (user_id, "My monthly budget", 31, stamp()))
    bid = cur.lastrowid
    mp = conn.execute("INSERT INTO accounts (budget_id, name, balance, sort) VALUES (?,?,?,?)", (bid, "M-Pesa", 0, 1)).lastrowid
    conn.execute("INSERT INTO accounts (budget_id, name, balance, sort) VALUES (?,?,?,?)", (bid, "Bank", 0, 2))
    salary = conn.execute(
        "INSERT INTO items (budget_id, name, amount, every_days, value_date, account_id, note, sort) VALUES (?,?,?,?,?,?,?,?)",
        (bid, "Salary (example)", 5000000, 0, (t + timedelta(days=5)).isoformat(), mp, "Delete or edit me", 1)).lastrowid
    conn.execute(
        "INSERT INTO items (budget_id, name, amount, every_days, value_date, tie_to, account_id, note, sort) VALUES (?,?,?,?,?,?,?,?,?)",
        (bid, "Rent (example)", -2000000, 0, t.isoformat(), salary, mp, "Tied to salary: paid when salary lands", 2))
    conn.execute(
        "INSERT INTO items (budget_id, name, amount, every_days, value_date, account_id, sort) VALUES (?,?,?,?,?,?,?)",
        (bid, "Food & transport (example)", -50000, 2, t.isoformat(), mp, 3))


def api_signup(req: Request):
    if not signup_limiter.allow(req.ip):
        raise HTTPError(429, "Too many sign-ups from this network. Try again later.")
    data = req.json()
    name = text(data.get("name"), "Name", 80, True)
    email = text(data.get("email"), "Email", 160, True).lower()
    if not EMAIL_RE.match(email):
        raise HTTPError(400, "Enter a valid email address.")
    phone_raw = text(data.get("phone"), "Phone", 20)
    phone = mpesa.normalize_phone(phone_raw) if phone_raw else None
    if phone_raw and not phone:
        raise HTTPError(400, "Enter a valid Safaricom number, e.g. 0712345678.")
    password = str(data.get("password") or "")
    if len(password) < 8:
        raise HTTPError(400, "Password must be at least 8 characters.")
    if len(password) > 200:
        raise HTTPError(400, "Password is too long.")
    trial_end = (config.today() + timedelta(days=config.TRIAL_DAYS - 1)).isoformat()
    try:
        cur = req.conn.execute(
            "INSERT INTO users (email, name, phone, password_hash, is_admin, trial_ends_at, created_at) VALUES (?,?,?,?,?,?,?)",
            (email, name, phone, hash_password(password), int(email in config.ADMIN_EMAILS), trial_end, stamp()))
    except sqlite3.IntegrityError:
        raise HTTPError(409, "An account with that email already exists. Log in instead.")
    seed_budget(req.conn, cur.lastrowid)
    start_session(req, cur.lastrowid)
    return 201, {"user": user_json(req.conn.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone())}


def api_login(req: Request):
    data = req.json()
    email = text(data.get("email"), "Email", 160, True).lower()
    if not (login_limiter.allow(req.ip) and login_limiter.allow("e:" + email)):
        raise HTTPError(429, "Too many login attempts. Wait 15 minutes and try again.")
    user = req.conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not user or not verify_password(str(data.get("password") or ""), user["password_hash"]):
        raise HTTPError(401, "Wrong email or password.")
    start_session(req, user["id"])
    return 200, {"user": user_json(user)}


RESET_SENT = {"ok": True, "message": "If that email has an account, we've sent a 6-digit code to it "
                                     "(and by SMS to its phone number, if saved)."}
RESET_INVALID = "That code is wrong or has expired. Request a new one."


def api_reset_request(req: Request):
    data = req.json()
    email = text(data.get("email"), "Email", 160, True).lower()
    if not EMAIL_RE.match(email):
        raise HTTPError(400, "Enter a valid email address.")
    if not reset_ip_limiter.allow(req.ip):
        raise HTTPError(429, "Too many reset requests. Try again later.")
    # Same response whether or not the account exists, so this can't be used to find users.
    if not reset_email_limiter.allow(email):
        return 200, RESET_SENT
    user = req.conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not user:
        return 200, RESET_SENT
    code = new_reset_code()
    salt, code_hash = hash_reset_code(code)
    expires = config.now() + timedelta(minutes=config.RESET_CODE_MINUTES)
    req.conn.execute("DELETE FROM password_resets WHERE user_id=?", (user["id"],))
    req.conn.execute(
        "INSERT INTO password_resets (user_id, code_hash, salt, expires_at, created_at) VALUES (?,?,?,?,?)",
        (user["id"], code_hash, salt, expires.isoformat(), stamp()))
    notify.send_reset_code(user["email"], user["phone"], user["name"], code)
    return 200, RESET_SENT


def api_reset_confirm(req: Request):
    if not reset_confirm_limiter.allow(req.ip):
        raise HTTPError(429, "Too many attempts. Wait 15 minutes and try again.")
    data = req.json()
    email = text(data.get("email"), "Email", 160, True).lower()
    code = re.sub(r"\s", "", str(data.get("code") or ""))
    new = str(data.get("new_password") or "")
    if not 8 <= len(new) <= 200:
        raise HTTPError(400, "New password must be at least 8 characters.")
    row = req.conn.execute(
        "SELECT r.*, u.id AS uid FROM password_resets r JOIN users u ON u.id = r.user_id WHERE u.email=? "
        "ORDER BY r.id DESC LIMIT 1", (email,)).fetchone()
    if not row or row["expires_at"] <= config.now().isoformat() or row["attempts"] >= config.RESET_MAX_ATTEMPTS:
        raise HTTPError(400, RESET_INVALID)
    if not verify_reset_code(code, row["salt"], row["code_hash"]):
        req.conn.execute("UPDATE password_resets SET attempts = attempts + 1 WHERE id=?", (row["id"],))
        raise HTTPError(400, RESET_INVALID)
    req.conn.execute("UPDATE users SET password_hash=? WHERE id=?", (hash_password(new), row["uid"]))
    req.conn.execute("DELETE FROM password_resets WHERE user_id=?", (row["uid"],))
    req.conn.execute("DELETE FROM sessions WHERE user_id=?", (row["uid"],))
    start_session(req, row["uid"])
    user = req.conn.execute("SELECT * FROM users WHERE id=?", (row["uid"],)).fetchone()
    return 200, {"user": user_json(user)}


def api_logout(req: Request):
    if req.session_token:
        req.conn.execute("DELETE FROM sessions WHERE token_hash=?", (hash_token(req.session_token),))
    set_cookie(req, "", 0)
    return 200, {"ok": True}


def api_me(req: Request):
    return 200, {"user": user_json(req.require_user()),
                 "plans": [{"key": k, **v} for k, v in config.PLANS.items()],
                 "app_name": config.APP_NAME, "mpesa_env": config.MPESA_ENV}


def api_update_me(req: Request):
    user = req.require_user()
    data = req.json()
    name = text(data.get("name", user["name"]), "Name", 80, True)
    phone_raw = text(data.get("phone", user["phone"] or ""), "Phone", 20)
    phone = mpesa.normalize_phone(phone_raw) if phone_raw else None
    if phone_raw and not phone:
        raise HTTPError(400, "Enter a valid Safaricom number, e.g. 0712345678.")
    req.conn.execute("UPDATE users SET name=?, phone=? WHERE id=?", (name, phone, user["id"]))
    return 200, {"user": user_json(req.conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone())}


def api_change_password(req: Request):
    user = req.require_user()
    data = req.json()
    if not verify_password(str(data.get("current") or ""), user["password_hash"]):
        raise HTTPError(400, "Current password is wrong.")
    new = str(data.get("new") or "")
    if not 8 <= len(new) <= 200:
        raise HTTPError(400, "New password must be at least 8 characters.")
    req.conn.execute("UPDATE users SET password_hash=? WHERE id=?", (hash_password(new), user["id"]))
    req.conn.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
    start_session(req, user["id"])
    return 200, {"ok": True}


# --------------------------------------------------------------------------- budgets

def api_list_budgets(req: Request):
    user = req.require_user()
    rows = req.conn.execute("SELECT id, name, horizon_days FROM budgets WHERE user_id=? ORDER BY id", (user["id"],)).fetchall()
    return 200, {"budgets": [dict(r) for r in rows]}


def api_create_budget(req: Request):
    user = req.require_active()
    data = req.json()
    count = req.conn.execute("SELECT COUNT(*) FROM budgets WHERE user_id=?", (user["id"],)).fetchone()[0]
    if count >= config.MAX_BUDGETS_PER_USER:
        raise HTTPError(400, f"You can have up to {config.MAX_BUDGETS_PER_USER} budgets.")
    name = text(data.get("name"), "Name", 80, True)
    src = own_budget(req, int_in(data["copy_from"], "copy_from", 1, 2**62)) if data.get("copy_from") else None
    cur = req.conn.execute("INSERT INTO budgets (user_id, name, horizon_days, created_at) VALUES (?,?,?,?)",
                           (user["id"], name, 31, stamp()))
    bid = cur.lastrowid
    if src:
        req.conn.execute("UPDATE budgets SET horizon_days=? WHERE id=?", (src["horizon_days"], bid))
        amap, imap = {}, {}
        for a in req.conn.execute("SELECT * FROM accounts WHERE budget_id=? ORDER BY id", (src["id"],)).fetchall():
            amap[a["id"]] = req.conn.execute(
                "INSERT INTO accounts (budget_id, name, details, balance, include_in_total, sort) VALUES (?,?,?,?,?,?)",
                (bid, a["name"], a["details"], a["balance"], a["include_in_total"], a["sort"])).lastrowid
        src_items = req.conn.execute("SELECT * FROM items WHERE budget_id=? ORDER BY id", (src["id"],)).fetchall()
        for i in src_items:
            imap[i["id"]] = req.conn.execute(
                "INSERT INTO items (budget_id, name, amount, every_days, value_date, end_date, done, account_id, note, sort) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (bid, i["name"], i["amount"], i["every_days"], i["value_date"], i["end_date"], i["done"],
                 amap.get(i["account_id"]), i["note"], i["sort"])).lastrowid
        for i in src_items:
            if i["tie_to"] in imap:
                req.conn.execute("UPDATE items SET tie_to=? WHERE id=?", (imap[i["tie_to"]], imap[i["id"]]))
    else:
        req.conn.execute("INSERT INTO accounts (budget_id, name, balance, sort) VALUES (?,?,?,?)", (bid, "M-Pesa", 0, 1))
    return 201, budget_payload(req, own_budget(req, bid))


def api_get_budget(req: Request, budget_id: str):
    return 200, budget_payload(req, own_budget(req, int(budget_id)))


def api_update_budget(req: Request, budget_id: str):
    req.require_active()
    b = own_budget(req, int(budget_id))
    data = req.json()
    name = text(data.get("name", b["name"]), "Name", 80, True)
    horizon = int_in(data.get("horizon_days", b["horizon_days"]), "Horizon", 7, 120, 31)
    req.conn.execute("UPDATE budgets SET name=?, horizon_days=? WHERE id=?", (name, horizon, b["id"]))
    return 200, budget_payload(req, own_budget(req, b["id"]))


def api_delete_budget(req: Request, budget_id: str):
    user = req.require_user()
    b = own_budget(req, int(budget_id))
    if req.conn.execute("SELECT COUNT(*) FROM budgets WHERE user_id=?", (user["id"],)).fetchone()[0] <= 1:
        raise HTTPError(400, "You need at least one budget.")
    req.conn.execute("DELETE FROM budgets WHERE id=?", (b["id"],))
    return 200, {"ok": True}


def api_export_csv(req: Request, budget_id: str):
    payload = budget_payload(req, own_budget(req, int(budget_id)))
    items = payload["items"]
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Date", "Day"] + [i["name"] for i in items] + ["Day's net flow", "Cumulative balance"])
    for d in payload["projection"]["days"]:
        dd = date.fromisoformat(d["date"])
        w.writerow([d["date"], dd.strftime("%a")] + [d["flows"].get(str(i["id"]), "") for i in items] + [d["net"], d["balance"]])
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", payload["budget"]["name"])[:40] or "budget"
    return ("csv", out.getvalue(), f"{safe}_{payload['projection']['today']}.csv")


# --------------------------------------------------------------------------- accounts & items

def _account_fields(data: dict, current: sqlite3.Row | None = None) -> tuple:
    g = lambda k, d=None: data[k] if k in data else (current[k] if current is not None else d)  # noqa: E731
    name = text(g("name", ""), "Account name", 60, True)
    details = text(g("details", ""), "Details", 200)
    balance = money(data["balance"], "balance") if "balance" in data else (current["balance"] if current is not None else 0)
    include = 1 if g("include_in_total", 1) else 0
    sort = int_in(g("sort", 0), "Sort", 0, 10_000)
    return name, details, balance, include, sort


def api_create_account(req: Request, budget_id: str):
    req.require_active()
    b = own_budget(req, int(budget_id))
    if req.conn.execute("SELECT COUNT(*) FROM accounts WHERE budget_id=?", (b["id"],)).fetchone()[0] >= 20:
        raise HTTPError(400, "Up to 20 accounts per budget.")
    req.conn.execute("INSERT INTO accounts (name, details, balance, include_in_total, sort, budget_id) VALUES (?,?,?,?,?,?)",
                     (*_account_fields(req.json()), b["id"]))
    return 201, budget_payload(req, b)


def api_update_account(req: Request, account_id: str):
    req.require_active()
    a = own_row(req, "accounts", int(account_id))
    req.conn.execute("UPDATE accounts SET name=?, details=?, balance=?, include_in_total=?, sort=? WHERE id=?",
                     (*_account_fields(req.json(), a), a["id"]))
    return 200, budget_payload(req, own_budget(req, a["budget_id"]))


def api_delete_account(req: Request, account_id: str):
    req.require_active()
    a = own_row(req, "accounts", int(account_id))
    req.conn.execute("DELETE FROM accounts WHERE id=?", (a["id"],))
    return 200, budget_payload(req, own_budget(req, a["budget_id"]))


def _item_fields(req: Request, budget_id: int, data: dict, current: sqlite3.Row | None = None) -> tuple:
    g = lambda k, d=None: data[k] if k in data else (current[k] if current is not None else d)  # noqa: E731
    name = text(g("name", ""), "Item name", 120, True)
    amount = money(data["amount"]) if "amount" in data else (current["amount"] if current is not None else 0)
    every = int_in(g("every_days", 0), "Every (days)", 0, 366)
    value_date = opt_date(g("value_date"), "Value date")
    end_date = opt_date(g("end_date"), "End date")
    if value_date and end_date and end_date < value_date:
        raise HTTPError(400, "End date can't be before the value date.")
    tie_to = g("tie_to")
    tie_to = int_in(tie_to, "Tie to", 1, 2**62) if tie_to not in (None, "", 0) else None
    if tie_to is not None:
        if current is not None and tie_to == current["id"]:
            raise HTTPError(400, "An item can't be tied to itself.")
        if not req.conn.execute("SELECT 1 FROM items WHERE id=? AND budget_id=?", (tie_to, budget_id)).fetchone():
            raise HTTPError(400, "Tied item not found in this budget.")
    account_id = g("account_id")
    account_id = int_in(account_id, "Account", 1, 2**62) if account_id not in (None, "", 0) else None
    if account_id is not None and not req.conn.execute(
            "SELECT 1 FROM accounts WHERE id=? AND budget_id=?", (account_id, budget_id)).fetchone():
        raise HTTPError(400, "Account not found in this budget.")
    done = 1 if g("done", 0) else 0
    note = text(g("note", ""), "Note", 500)
    sort = int_in(g("sort", 0), "Sort", 0, 100_000)
    return name, amount, every, value_date, end_date, tie_to, done, account_id, note, sort


def api_create_item(req: Request, budget_id: str):
    req.require_active()
    b = own_budget(req, int(budget_id))
    if req.conn.execute("SELECT COUNT(*) FROM items WHERE budget_id=?", (b["id"],)).fetchone()[0] >= config.MAX_ITEMS_PER_BUDGET:
        raise HTTPError(400, f"Up to {config.MAX_ITEMS_PER_BUDGET} items per budget.")
    data = req.json()
    if "sort" not in data:
        data["sort"] = req.conn.execute("SELECT COALESCE(MAX(sort),0)+1 FROM items WHERE budget_id=?", (b["id"],)).fetchone()[0]
    req.conn.execute(
        "INSERT INTO items (name, amount, every_days, value_date, end_date, tie_to, done, account_id, note, sort, budget_id) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)", (*_item_fields(req, b["id"], data), b["id"]))
    return 201, budget_payload(req, b)


def api_update_item(req: Request, item_id: str):
    req.require_active()
    i = own_row(req, "items", int(item_id))
    req.conn.execute(
        "UPDATE items SET name=?, amount=?, every_days=?, value_date=?, end_date=?, tie_to=?, done=?, account_id=?, note=?, sort=? "
        "WHERE id=?", (*_item_fields(req, i["budget_id"], req.json(), i), i["id"]))
    return 200, budget_payload(req, own_budget(req, i["budget_id"]))


def api_delete_item(req: Request, item_id: str):
    req.require_active()
    i = own_row(req, "items", int(item_id))
    req.conn.execute("DELETE FROM items WHERE id=?", (i["id"],))
    return 200, budget_payload(req, own_budget(req, i["budget_id"]))


# --------------------------------------------------------------------------- billing

def api_subscribe(req: Request):
    user = req.require_user()
    if not pay_limiter.allow(f"u:{user['id']}"):
        raise HTTPError(429, "Too many payment attempts. Wait a few minutes.")
    data = req.json()
    try:
        p = billing.start_payment(req.conn, user, str(data.get("plan") or ""), str(data.get("phone") or user["phone"] or ""))
    except ValueError as e:
        raise HTTPError(400, str(e))
    except mpesa.MpesaError as e:
        raise HTTPError(502, str(e))
    return 201, {"payment": payment_json(p),
                 "message": "Check your phone and enter your M-Pesa PIN to complete payment."}


def api_payment_status(req: Request, payment_id: str):
    user = req.require_user()
    p = req.conn.execute("SELECT * FROM payments WHERE id=? AND user_id=?", (int(payment_id), user["id"])).fetchone()
    if not p:
        raise HTTPError(404, "Payment not found.")
    p = billing.refresh(req.conn, p)
    user = req.conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
    return 200, {"payment": payment_json(p), "user": user_json(user)}


def api_payments(req: Request):
    user = req.require_user()
    rows = req.conn.execute("SELECT * FROM payments WHERE user_id=? ORDER BY id DESC LIMIT 50", (user["id"],)).fetchall()
    return 200, {"payments": [payment_json(p) for p in rows]}


def api_mpesa_callback(req: Request, secret: str):
    import hmac as _hmac
    if not _hmac.compare_digest(secret, config.MPESA_CALLBACK_SECRET):
        raise HTTPError(404, "Not found.")
    try:
        billing.handle_callback(req.conn, req.json())
    except HTTPError:
        pass
    # Daraja only needs an acknowledgement; never leak internals.
    return 200, {"ResultCode": 0, "ResultDesc": "Accepted"}


def api_admin_stats(req: Request):
    user = req.require_user()
    if not user["is_admin"]:
        raise HTTPError(403, "Admins only.")
    q = lambda sql, *a: req.conn.execute(sql, a).fetchone()[0]  # noqa: E731
    today = config.today().isoformat()
    return 200, {
        "users": q("SELECT COUNT(*) FROM users"),
        "paying_users": q("SELECT COUNT(*) FROM users WHERE paid_until >= ?", today),
        "trial_users": q("SELECT COUNT(*) FROM users WHERE trial_ends_at >= ? AND (paid_until IS NULL OR paid_until < ?)", today, today),
        "revenue_kes": q("SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='success'"),
        "payments_30d": q("SELECT COUNT(*) FROM payments WHERE status='success' AND created_at >= ?",
                          (config.today() - timedelta(days=30)).isoformat()),
    }


# --------------------------------------------------------------------------- routing

ROUTES: list[tuple[str, re.Pattern, object]] = []


def route(method: str, pattern: str, handler) -> None:
    ROUTES.append((method, re.compile("^" + pattern + "$"), handler))


route("POST", r"/api/auth/signup", api_signup)
route("POST", r"/api/auth/login", api_login)
route("POST", r"/api/auth/logout", api_logout)
route("POST", r"/api/auth/reset/request", api_reset_request)
route("POST", r"/api/auth/reset/confirm", api_reset_confirm)
route("GET", r"/api/me", api_me)
route("PUT", r"/api/me", api_update_me)
route("POST", r"/api/me/password", api_change_password)
route("GET", r"/api/budgets", api_list_budgets)
route("POST", r"/api/budgets", api_create_budget)
route("GET", r"/api/budgets/(\d+)", api_get_budget)
route("PUT", r"/api/budgets/(\d+)", api_update_budget)
route("DELETE", r"/api/budgets/(\d+)", api_delete_budget)
route("GET", r"/api/budgets/(\d+)/export\.csv", api_export_csv)
route("POST", r"/api/budgets/(\d+)/accounts", api_create_account)
route("PUT", r"/api/accounts/(\d+)", api_update_account)
route("DELETE", r"/api/accounts/(\d+)", api_delete_account)
route("POST", r"/api/budgets/(\d+)/items", api_create_item)
route("PUT", r"/api/items/(\d+)", api_update_item)
route("DELETE", r"/api/items/(\d+)", api_delete_item)
route("POST", r"/api/billing/subscribe", api_subscribe)
route("GET", r"/api/billing/payments", api_payments)
route("GET", r"/api/billing/payments/(\d+)", api_payment_status)
route("POST", r"/api/mpesa/callback/([A-Za-z0-9_-]+)", api_mpesa_callback)
route("GET", r"/api/admin/stats", api_admin_stats)


# Explicit map: the OS registry (notably on Windows) can report .js as text/plain,
# which browsers refuse to execute.
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


def serve_static(path: str, start_response):
    rel = path.lstrip("/")
    if rel.startswith("static/"):
        rel = rel[len("static/"):]
    else:
        rel = "index.html"  # SPA fallback
    target = (STATIC_DIR / rel).resolve()
    if STATIC_DIR.resolve() not in target.parents or not target.is_file():
        target = STATIC_DIR / "index.html"
    body = target.read_bytes()
    ctype = MIME_TYPES.get(target.suffix.lower()) or mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    cache = "no-cache" if target.name in ("index.html", "sw.js") else "public, max-age=300"
    start_response("200 OK", [("Content-Type", ctype), ("Content-Length", str(len(body))),
                              ("Cache-Control", cache), *SECURITY_HEADERS])
    return [body]


def respond_json(start_response, status: int, payload, cookies=()):
    body = json.dumps(payload).encode()
    headers = [("Content-Type", "application/json; charset=utf-8"), ("Content-Length", str(len(body))),
               ("Cache-Control", "no-store"), *SECURITY_HEADERS]
    headers += [("Set-Cookie", c) for c in cookies]
    start_response(f"{status} {STATUS_TEXT.get(status, '')}", headers)
    return [body]


_initialized = False


def application(environ, start_response):
    global _initialized
    if not _initialized:
        db.init()
        _initialized = True
    path = environ.get("PATH_INFO", "/") or "/"
    method = environ["REQUEST_METHOD"].upper()

    if path == "/healthz":
        return respond_json(start_response, 200, {"ok": True})
    if not path.startswith("/api/"):
        if method not in ("GET", "HEAD"):
            return respond_json(start_response, 405, {"error": "Method not allowed."})
        return serve_static(path, start_response)

    conn = db.connect()
    req = Request(environ, conn)
    try:
        # CSRF defence: state-changing API calls must come from our own JS (custom header
        # can't be sent cross-site without a CORS preflight we never approve). Daraja's
        # server-to-server callback is exempt and authenticated by its secret URL instead.
        if method not in ("GET", "HEAD") and not path.startswith("/api/mpesa/callback/"):
            if environ.get("HTTP_X_REQUESTED_WITH") != "fetch":
                raise HTTPError(403, "Missing request header.")
        for m, pattern, handler in ROUTES:
            match = pattern.match(path)
            if match and m == method:
                result = handler(req, *match.groups())
                if result[0] == "csv":
                    _, body, filename = result
                    data = ("﻿" + body).encode("utf-8")
                    start_response("200 OK", [("Content-Type", "text/csv; charset=utf-8"),
                                              ("Content-Disposition", f'attachment; filename="{filename}"'),
                                              ("Content-Length", str(len(data))), ("Cache-Control", "no-store"),
                                              *SECURITY_HEADERS])
                    return [data]
                status, payload = result
                return respond_json(start_response, status, payload, req.set_cookies)
        if any(p.match(path) for _, p, _ in ROUTES):
            raise HTTPError(405, "Method not allowed.")
        raise HTTPError(404, "Not found.")
    except HTTPError as e:
        return respond_json(start_response, e.status, {"error": e.message, **e.extra}, req.set_cookies)
    except Exception:
        traceback.print_exc()
        return respond_json(start_response, 500, {"error": "Something went wrong. Please try again."})
    finally:
        conn.close()
