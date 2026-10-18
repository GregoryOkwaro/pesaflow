"""Outbound messages (password-reset codes) by email and/or SMS.

NOTIFY_ENV=mock prints messages to the server log and keeps them in `outbox`
(tests read codes from there). NOTIFY_ENV=live sends by SMTP email when SMTP
is configured and by Africa's Talking SMS when the user has a phone number and
AT is configured. Live sends run on a background thread so the reset request
takes the same time whether or not the email belongs to an account.
"""
from __future__ import annotations

import json
import smtplib
import ssl
import threading
import traceback
import urllib.parse
import urllib.request
from email.message import EmailMessage

from . import config

outbox: list[dict] = []


def _send_email(to: str, subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["From"] = config.SMTP_FROM or config.SMTP_USER
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    ctx = ssl.create_default_context()
    if config.SMTP_SECURITY == "ssl":
        server = smtplib.SMTP_SSL(config.SMTP_HOST, config.SMTP_PORT, context=ctx, timeout=20)
    else:
        server = smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=20)
    with server:
        if config.SMTP_SECURITY == "starttls":
            server.starttls(context=ctx)
        if config.SMTP_USER:
            server.login(config.SMTP_USER, config.SMTP_PASSWORD)
        server.send_message(msg)


def _send_sms(phone: str, body: str) -> None:
    host = "api.sandbox.africastalking.com" if config.AT_USERNAME == "sandbox" else "api.africastalking.com"
    fields = {"username": config.AT_USERNAME, "to": "+" + phone.lstrip("+"), "message": body}
    if config.AT_SENDER_ID:
        fields["from"] = config.AT_SENDER_ID
    req = urllib.request.Request(
        f"https://{host}/version1/messaging", data=urllib.parse.urlencode(fields).encode(), method="POST",
        headers={"apiKey": config.AT_API_KEY, "Accept": "application/json",
                 "Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode() or "{}")
    recipients = (data.get("SMSMessageData") or {}).get("Recipients") or []
    if not recipients or recipients[0].get("status") != "Success":
        raise RuntimeError(f"SMS not accepted: {data}")


def _deliver(email: str, phone: str | None, subject: str, body: str) -> None:
    if config.SMTP_HOST:
        try:
            _send_email(email, subject, body)
        except Exception:
            traceback.print_exc()
    if phone and config.AT_USERNAME and config.AT_API_KEY:
        try:
            _send_sms(phone, body)
        except Exception:
            traceback.print_exc()


def send_reset_code(email: str, phone: str | None, name: str, code: str) -> None:
    subject = f"{config.APP_NAME} password reset code"
    body = (f"Hi {name}, your {config.APP_NAME} reset code is {code}. "
            f"It expires in {config.RESET_CODE_MINUTES} minutes. If you didn't ask for this, ignore this message.")
    if config.NOTIFY_ENV != "live":
        outbox.append({"email": email, "phone": phone, "subject": subject, "body": body, "code": code})
        del outbox[:-50]
        print(f"[notify:mock] to={email} phone={phone or '-'} :: {body}", flush=True)
        return
    threading.Thread(target=_deliver, args=(email, phone, subject, body), daemon=True).start()


def live_channels_configured() -> bool:
    return bool(config.SMTP_HOST) or bool(config.AT_USERNAME and config.AT_API_KEY)
