"""Subscriptions paid through M-Pesa STK push.

Access model: every new account gets a free trial. After it ends the account
is read-only until a plan is paid; each successful payment extends paid_until
by the plan's days, starting from whichever is later of today, the trial end
or the current paid_until (so paying early never loses days).
"""
from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta

from . import config, mpesa

# Daraja "still processing" responses to an STK query.
_PENDING_QUERY_CODES = {"500.001.1001"}


def access_until(user: sqlite3.Row) -> date:
    trial = date.fromisoformat(user["trial_ends_at"])
    paid = date.fromisoformat(user["paid_until"]) if user["paid_until"] else trial
    return max(trial, paid)


def status(user: sqlite3.Row) -> dict:
    until = access_until(user)
    today = config.today()
    active = until >= today
    paid = bool(user["paid_until"]) and date.fromisoformat(user["paid_until"]) >= today
    return {
        "active": active,
        "on_trial": active and not paid,
        "access_until": until.isoformat(),
        "days_left": max(0, (until - today).days + 1) if active else 0,
    }


def start_payment(conn: sqlite3.Connection, user: sqlite3.Row, plan_key: str, raw_phone: str) -> sqlite3.Row:
    plan = config.PLANS.get(plan_key)
    if not plan:
        raise ValueError("Unknown plan.")
    phone = mpesa.normalize_phone(raw_phone)
    if not phone:
        raise ValueError("Enter a valid Safaricom number, e.g. 0712345678.")
    stamp = config.now().isoformat(timespec="seconds")
    cur = conn.execute(
        "INSERT INTO payments (user_id, plan, amount, phone, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        (user["id"], plan_key, plan["amount"], phone, stamp, stamp),
    )
    pid = cur.lastrowid
    try:
        resp = mpesa.stk_push(phone, plan["amount"], f"PF{user['id']}", f"{plan['label']} plan")
    except mpesa.MpesaError as e:
        conn.execute("UPDATE payments SET status='failed', result_desc=?, updated_at=? WHERE id=?", (str(e), stamp, pid))
        raise
    conn.execute(
        "UPDATE payments SET checkout_request_id=?, merchant_request_id=? WHERE id=?",
        (resp["CheckoutRequestID"], resp.get("MerchantRequestID"), pid),
    )
    return conn.execute("SELECT * FROM payments WHERE id=?", (pid,)).fetchone()


def _apply(conn: sqlite3.Connection, payment_id: int) -> None:
    """Extend the subscription exactly once per successful payment."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        p = conn.execute("SELECT * FROM payments WHERE id=?", (payment_id,)).fetchone()
        if not p or p["status"] != "success" or p["applied"]:
            conn.execute("COMMIT")
            return
        user = conn.execute("SELECT * FROM users WHERE id=?", (p["user_id"],)).fetchone()
        start = max(config.today() - timedelta(days=1), access_until(user))
        new_until = start + timedelta(days=config.PLANS[p["plan"]]["days"])
        conn.execute("UPDATE users SET paid_until=? WHERE id=?", (new_until.isoformat(), user["id"]))
        conn.execute("UPDATE payments SET applied=1 WHERE id=?", (payment_id,))
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


def _finish(conn: sqlite3.Connection, p: sqlite3.Row, success: bool, code: str, desc: str, receipt: str | None) -> None:
    stamp = config.now().isoformat(timespec="seconds")
    cur = conn.execute(
        "UPDATE payments SET status=?, result_code=?, result_desc=?, receipt=COALESCE(?, receipt), updated_at=? "
        "WHERE id=? AND status='pending'",
        ("success" if success else "failed", code, desc, receipt, stamp, p["id"]),
    )
    if cur.rowcount and success:
        _apply(conn, p["id"])


def handle_callback(conn: sqlite3.Connection, payload: dict) -> None:
    data = mpesa.parse_callback(payload)
    if not data["checkout_request_id"]:
        return
    p = conn.execute("SELECT * FROM payments WHERE checkout_request_id=?", (data["checkout_request_id"],)).fetchone()
    if not p or p["status"] != "pending":
        return
    success = data["result_code"] == "0"
    if success:
        try:
            paid = int(float(data["amount"] or 0))
        except (TypeError, ValueError):
            paid = 0
        if paid < p["amount"]:
            success, data["result_desc"] = False, f"Amount mismatch: paid {paid}, expected {p['amount']}"
    try:
        _finish(conn, p, success, data["result_code"], data["result_desc"], data["receipt"])
    except sqlite3.IntegrityError:  # duplicate receipt number replayed against another payment
        _finish(conn, p, False, data["result_code"], "Duplicate receipt", None)


def refresh(conn: sqlite3.Connection, p: sqlite3.Row) -> sqlite3.Row:
    """Fallback when the callback is slow or lost: ask Daraja directly."""
    if p["status"] == "pending" and p["checkout_request_id"]:
        created = datetime.fromisoformat(p["created_at"])
        age = (config.now() - created).total_seconds()
        if age >= 5 or config.MPESA_ENV == "mock":
            try:
                q = mpesa.stk_query(p["checkout_request_id"])
            except mpesa.MpesaError:
                q = {}
            code = q.get("ResultCode")
            if code is not None and str(q.get("errorCode")) not in _PENDING_QUERY_CODES:
                _finish(conn, p, str(code) == "0", str(code), q.get("ResultDesc", ""), None)
            elif age > 300:
                _finish(conn, p, False, "timeout", "No response from M-Pesa. Please try again.", None)
    return conn.execute("SELECT * FROM payments WHERE id=?", (p["id"],)).fetchone()
