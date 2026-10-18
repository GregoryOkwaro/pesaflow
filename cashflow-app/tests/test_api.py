"""End-to-end API tests through the WSGI app (no server needed)."""
import io
import json
import os
import tempfile
import unittest
from datetime import timedelta
from wsgiref.util import setup_testing_defaults

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_PATH"] = os.path.join(_tmp, "test.db")
os.environ["MPESA_ENV"] = "mock"
os.environ["MPESA_CALLBACK_SECRET"] = "s3cret"
os.environ["NOTIFY_ENV"] = "mock"

from app import config, notify, web  # noqa: E402

web.signup_limiter.limit = 1000
web.login_limiter.limit = 1000
web.pay_limiter.limit = 1000
web.reset_ip_limiter.limit = 1000
web.reset_email_limiter.limit = 1000
web.reset_confirm_limiter.limit = 1000


class Client:
    def __init__(self):
        self.cookie = ""

    def call(self, method, path, body=None, headers=None):
        env = {}
        setup_testing_defaults(env)
        raw = json.dumps(body).encode() if body is not None else b""
        env.update({"REQUEST_METHOD": method, "PATH_INFO": path, "CONTENT_LENGTH": str(len(raw)),
                    "wsgi.input": io.BytesIO(raw), "HTTP_COOKIE": self.cookie,
                    "HTTP_X_REQUESTED_WITH": "fetch", "CONTENT_TYPE": "application/json"})
        env.update(headers or {})
        out = {}

        def start_response(status, hdrs):
            out["status"] = int(status.split()[0])
            out["headers"] = hdrs

        body_bytes = b"".join(web.application(env, start_response))
        for k, v in out["headers"]:
            if k == "Set-Cookie":
                self.cookie = v.split(";")[0]
        ctype = dict(out["headers"]).get("Content-Type", "")
        data = json.loads(body_bytes) if "json" in ctype else body_bytes.decode("utf-8-sig")
        return out["status"], data


def signup(email):
    c = Client()
    s, d = c.call("POST", "/api/auth/signup", {"name": "Test", "email": email, "password": "password123", "phone": "0712345678"})
    assert s == 201, d
    return c


class ApiTests(unittest.TestCase):
    def test_signup_seeds_budget_and_projection(self):
        c = signup("a@example.com")
        s, d = c.call("GET", "/api/budgets")
        self.assertEqual(s, 200)
        bid = d["budgets"][0]["id"]
        s, d = c.call("GET", f"/api/budgets/{bid}")
        self.assertEqual(len(d["projection"]["days"]), 31)
        self.assertEqual(len(d["items"]), 3)

    def test_duplicate_email_and_bad_login(self):
        signup("dup@example.com")
        s, _ = Client().call("POST", "/api/auth/signup", {"name": "x", "email": "DUP@example.com", "password": "password123"})
        self.assertEqual(s, 409)
        s, _ = Client().call("POST", "/api/auth/login", {"email": "dup@example.com", "password": "wrong-pass"})
        self.assertEqual(s, 401)
        s, _ = Client().call("POST", "/api/auth/login", {"email": "dup@example.com", "password": "password123"})
        self.assertEqual(s, 200)

    def test_item_crud_and_projection(self):
        c = signup("crud@example.com")
        bid = c.call("GET", "/api/budgets")[1]["budgets"][0]["id"]
        d = c.call("GET", f"/api/budgets/{bid}")[1]
        acct = d["accounts"][0]["id"]
        s, d = c.call("PUT", f"/api/accounts/{acct}", {"balance": "1,000.50"})
        self.assertEqual(s, 200)
        self.assertEqual(d["projection"]["opening_balance"], 1000.5)
        for i in d["items"]:
            c.call("DELETE", f"/api/items/{i['id']}")
        today = config.today().isoformat()
        s, d = c.call("POST", f"/api/budgets/{bid}/items", {"name": "Lunch", "amount": -100, "every_days": 1, "value_date": today})
        self.assertEqual(s, 201)
        self.assertEqual(d["projection"]["closing_balance"], 1000.5 - 3100)
        item = d["items"][0]["id"]
        s, d = c.call("PUT", f"/api/items/{item}", {"done": True})
        self.assertEqual(d["projection"]["closing_balance"], 1000.5)
        s, d = c.call("PUT", f"/api/items/{item}", {"tie_to": item})
        self.assertEqual(s, 400)
        s, csv_text = c.call("GET", f"/api/budgets/{bid}/export.csv")
        self.assertEqual(s, 200)
        self.assertIn("Cumulative balance", csv_text)

    def test_users_cannot_see_each_others_data(self):
        a, b = signup("owner@example.com"), signup("intruder@example.com")
        bid = a.call("GET", "/api/budgets")[1]["budgets"][0]["id"]
        item = a.call("GET", f"/api/budgets/{bid}")[1]["items"][0]["id"]
        self.assertEqual(b.call("GET", f"/api/budgets/{bid}")[0], 404)
        self.assertEqual(b.call("PUT", f"/api/items/{item}", {"name": "pwned"})[0], 404)
        self.assertEqual(b.call("POST", f"/api/budgets/{bid}/items", {"name": "x"})[0], 404)
        self.assertEqual(b.call("POST", "/api/budgets", {"name": "x", "copy_from": bid})[0], 404)

    def test_csrf_header_required(self):
        c = signup("csrf@example.com")
        s, _ = c.call("POST", "/api/budgets", {"name": "x"}, headers={"HTTP_X_REQUESTED_WITH": ""})
        self.assertEqual(s, 403)

    def _expire(self, email):
        from app import db
        conn = db.connect()
        past = (config.today() - timedelta(days=1)).isoformat()
        conn.execute("UPDATE users SET trial_ends_at=?, paid_until=NULL WHERE email=?", (past, email))
        conn.close()

    def test_paywall_then_mock_mpesa_payment_unlocks(self):
        c = signup("pay@example.com")
        self._expire("pay@example.com")
        bid = c.call("GET", "/api/budgets")[1]["budgets"][0]["id"]
        s, d = c.call("POST", f"/api/budgets/{bid}/items", {"name": "x", "amount": -1})
        self.assertEqual(s, 402)
        self.assertEqual(c.call("GET", f"/api/budgets/{bid}")[0], 200)  # read-only still works
        s, d = c.call("POST", "/api/billing/subscribe", {"plan": "monthly", "phone": "+254 712 345 678"})
        self.assertEqual(s, 201, d)
        self.assertEqual(d["payment"]["phone"], "254712345678")
        s, d = c.call("GET", f"/api/billing/payments/{d['payment']['id']}")
        self.assertEqual(d["payment"]["status"], "success")
        self.assertTrue(d["user"]["subscription"]["active"])
        self.assertEqual(d["user"]["subscription"]["days_left"], 30)
        s, _ = c.call("POST", f"/api/budgets/{bid}/items", {"name": "x", "amount": -1})
        self.assertEqual(s, 201)

    def test_daraja_callback_success_failure_and_replay(self):
        from app import db
        c = signup("cb@example.com")
        self._expire("cb@example.com")
        os.environ["MPESA_ENV"] = "mock"
        _, d = c.call("POST", "/api/billing/subscribe", {"plan": "yearly", "phone": "0712345678"})
        conn = db.connect()
        checkout = conn.execute("SELECT checkout_request_id FROM payments WHERE id=?", (d["payment"]["id"],)).fetchone()[0]

        def cb(code, amount, receipt="QWE123RTY"):
            return {"Body": {"stkCallback": {"MerchantRequestID": "m", "CheckoutRequestID": checkout, "ResultCode": code,
                    "ResultDesc": "ok", "CallbackMetadata": {"Item": [{"Name": "Amount", "Value": amount},
                    {"Name": "MpesaReceiptNumber", "Value": receipt}, {"Name": "PhoneNumber", "Value": 254712345678}]}}}}

        anon = Client()
        self.assertEqual(anon.call("POST", "/api/mpesa/callback/wrong", cb(0, 2999))[0], 404)
        # Underpayment is rejected.
        s, _ = anon.call("POST", "/api/mpesa/callback/s3cret", cb(0, 1), headers={"HTTP_X_REQUESTED_WITH": ""})
        self.assertEqual(s, 200)
        row = conn.execute("SELECT status FROM payments WHERE checkout_request_id=?", (checkout,)).fetchone()
        self.assertEqual(row[0], "failed")
        # A fresh, correct payment applies exactly once even if Daraja retries the callback.
        _, d = c.call("POST", "/api/billing/subscribe", {"plan": "yearly", "phone": "0712345678"})
        checkout = conn.execute("SELECT checkout_request_id FROM payments WHERE id=?", (d["payment"]["id"],)).fetchone()[0]
        anon.call("POST", "/api/mpesa/callback/s3cret", cb(0, 2999, "RCPT2NEW99"))
        anon.call("POST", "/api/mpesa/callback/s3cret", cb(0, 2999, "RCPT2NEW99"))
        _, me = c.call("GET", "/api/me")
        self.assertEqual(me["user"]["subscription"]["days_left"], 365)
        conn.close()


class PasswordResetTests(unittest.TestCase):
    def _request(self, email):
        before = len(notify.outbox)
        s, d = Client().call("POST", "/api/auth/reset/request", {"email": email})
        self.assertEqual(s, 200)
        return d, (notify.outbox[-1]["code"] if len(notify.outbox) > before else None)

    def _confirm(self, client, email, code, pw="brand-new-pass"):
        return client.call("POST", "/api/auth/reset/confirm", {"email": email, "code": code, "new_password": pw})

    def test_unknown_email_looks_the_same_and_sends_nothing(self):
        signup("known@example.com")
        known, code = self._request("known@example.com")
        unknown, none = self._request("nobody@example.com")
        self.assertEqual(known, unknown)
        self.assertIsNotNone(code)
        self.assertIsNone(none)
        self.assertEqual(self._confirm(Client(), "nobody@example.com", "123456")[0], 400)

    def test_successful_reset_logs_in_and_kills_old_sessions(self):
        old = signup("reset@example.com")
        self.assertEqual(old.call("GET", "/api/me")[0], 200)
        _, code = self._request("reset@example.com")
        fresh = Client()
        s, d = self._confirm(fresh, "reset@example.com", f"{code[:3]} {code[3:]}")  # spaces tolerated
        self.assertEqual(s, 200, d)
        self.assertEqual(fresh.call("GET", "/api/me")[0], 200)
        self.assertEqual(old.call("GET", "/api/me")[0], 401)
        self.assertEqual(Client().call("POST", "/api/auth/login", {"email": "reset@example.com", "password": "password123"})[0], 401)
        self.assertEqual(Client().call("POST", "/api/auth/login", {"email": "reset@example.com", "password": "brand-new-pass"})[0], 200)
        # A code works once only.
        self.assertEqual(self._confirm(Client(), "reset@example.com", code)[0], 400)

    def test_wrong_codes_use_up_attempts(self):
        signup("brute@example.com")
        _, code = self._request("brute@example.com")
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(config.RESET_MAX_ATTEMPTS):
            self.assertEqual(self._confirm(Client(), "brute@example.com", wrong)[0], 400)
        # Even the right code is refused once attempts are exhausted.
        self.assertEqual(self._confirm(Client(), "brute@example.com", code)[0], 400)

    def test_expired_code_rejected(self):
        from app import db
        signup("late@example.com")
        _, code = self._request("late@example.com")
        conn = db.connect()
        conn.execute("UPDATE password_resets SET expires_at=? WHERE user_id=(SELECT id FROM users WHERE email=?)",
                     ((config.now() - timedelta(minutes=1)).isoformat(), "late@example.com"))
        conn.close()
        self.assertEqual(self._confirm(Client(), "late@example.com", code)[0], 400)

    def test_new_request_replaces_old_code_and_short_password_rejected(self):
        signup("twice@example.com")
        _, first = self._request("twice@example.com")
        _, second = self._request("twice@example.com")
        if first != second:
            self.assertEqual(self._confirm(Client(), "twice@example.com", first)[0], 400)
        self.assertEqual(self._confirm(Client(), "twice@example.com", second, pw="short")[0], 400)
        self.assertEqual(self._confirm(Client(), "twice@example.com", second)[0], 200)

    def test_email_rate_limit_still_answers_generically(self):
        signup("limited@example.com")
        web.reset_email_limiter.limit = 1
        web.reset_email_limiter._hits.clear()
        try:
            d1, c1 = self._request("limited@example.com")
            d2, c2 = self._request("limited@example.com")
        finally:
            web.reset_email_limiter.limit = 1000
        self.assertEqual(d1, d2)
        self.assertIsNotNone(c1)
        self.assertIsNone(c2)


if __name__ == "__main__":
    unittest.main()
