"""Runtime configuration, read from environment variables (see .env.example)."""
from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if value[:1] in ('"', "'") and value[0] in value[1:]:
            value = value[1:value.index(value[0], 1)]
        else:
            value = "" if value.startswith("#") else re.split(r"\s+#", value, maxsplit=1)[0].strip()  # drop "  # comment"
        os.environ.setdefault(key.strip(), value)


_load_dotenv(BASE_DIR / ".env")


def env(name: str, default: str = "") -> str:
    return os.environ.get(name) or default  # blank in .env means "use the default"


APP_NAME = env("APP_NAME", "PesaFlow")
DATABASE_PATH = env("DATABASE_PATH", str(BASE_DIR / "data" / "cashflow.db"))
PUBLIC_URL = env("PUBLIC_URL", "http://localhost:8000").rstrip("/")
COOKIE_SECURE = PUBLIC_URL.startswith("https://")
SESSION_DAYS = int(env("SESSION_DAYS", "30"))
TRIAL_DAYS = int(env("TRIAL_DAYS", "14"))
MAX_ITEMS_PER_BUDGET = int(env("MAX_ITEMS_PER_BUDGET", "200"))
MAX_BUDGETS_PER_USER = int(env("MAX_BUDGETS_PER_USER", "10"))

# Subscription plans, priced in whole KES (M-Pesa only accepts whole shillings).
PLANS = {
    "monthly": {"label": "Monthly", "amount": int(env("PLAN_MONTHLY_KES", "299")), "days": 30},
    "quarterly": {"label": "3 months", "amount": int(env("PLAN_QUARTERLY_KES", "799")), "days": 91},
    "yearly": {"label": "Yearly", "amount": int(env("PLAN_YEARLY_KES", "2999")), "days": 365},
}

# M-Pesa Daraja. MPESA_ENV: "mock" (local dev, no network), "sandbox" or "production".
MPESA_ENV = env("MPESA_ENV", "mock")
MPESA_CONSUMER_KEY = env("MPESA_CONSUMER_KEY")
MPESA_CONSUMER_SECRET = env("MPESA_CONSUMER_SECRET")
MPESA_SHORTCODE = env("MPESA_SHORTCODE", "174379")
MPESA_PASSKEY = env("MPESA_PASSKEY")
# CustomerPayBillOnline for a paybill, CustomerBuyGoodsOnline for a till.
MPESA_TRANSACTION_TYPE = env("MPESA_TRANSACTION_TYPE", "CustomerPayBillOnline")
# For till numbers PartyB is the till while BusinessShortCode is the store number.
MPESA_PARTY_B = env("MPESA_PARTY_B", MPESA_SHORTCODE)
# Random secret embedded in the callback URL so only Safaricom (who we give it to) can hit it.
MPESA_CALLBACK_SECRET = env("MPESA_CALLBACK_SECRET", "change-me")

# Password-reset delivery. NOTIFY_ENV: "mock" (codes printed to the server log, for local
# dev only) or "live" (send by email via SMTP and/or SMS via Africa's Talking).
NOTIFY_ENV = env("NOTIFY_ENV", "mock")
RESET_CODE_MINUTES = int(env("RESET_CODE_MINUTES", "15"))
RESET_MAX_ATTEMPTS = int(env("RESET_MAX_ATTEMPTS", "5"))
SMTP_HOST = env("SMTP_HOST")
SMTP_PORT = int(env("SMTP_PORT", "587"))
SMTP_USER = env("SMTP_USER")
SMTP_PASSWORD = env("SMTP_PASSWORD")
SMTP_FROM = env("SMTP_FROM")
SMTP_SECURITY = env("SMTP_SECURITY", "starttls")  # starttls | ssl | none
AT_USERNAME = env("AT_USERNAME")  # "sandbox" for Africa's Talking's sandbox
AT_API_KEY = env("AT_API_KEY")
AT_SENDER_ID = env("AT_SENDER_ID")  # optional approved alphanumeric sender ID

ADMIN_EMAILS ={e.strip().lower() for e in env("ADMIN_EMAILS").split(",") if e.strip()}

# Kenya has no DST, so a fixed UTC+3 offset is exact.
NAIROBI = timezone(timedelta(hours=3))


def now() -> datetime:
    return datetime.now(NAIROBI)


def today():
    return now().date()
