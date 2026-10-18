"""Safaricom Daraja client: Lipa Na M-Pesa Online (STK push) and its status query.

MPESA_ENV=mock never touches the network: pushes are accepted and the status
query reports success, so the whole subscribe flow can be exercised locally.
"""
from __future__ import annotations

import base64
import json
import re
import secrets
import threading
import time
import urllib.error
import urllib.request

from . import config

HOSTS = {
    "sandbox": "https://sandbox.safaricom.co.ke",
    "production": "https://api.safaricom.co.ke",
}


class MpesaError(Exception):
    pass


def normalize_phone(raw: str) -> str | None:
    """07XXXXXXXX / 01XXXXXXXX / +2547XXXXXXXX / 2547XXXXXXXX -> 2547XXXXXXXX."""
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("0") and len(digits) == 10:
        digits = "254" + digits[1:]
    elif len(digits) == 9 and digits[0] in "17":
        digits = "254" + digits
    if re.fullmatch(r"254[17]\d{8}", digits):
        return digits
    return None


def _timestamp() -> str:
    return config.now().strftime("%Y%m%d%H%M%S")


def _password(ts: str) -> str:
    return base64.b64encode(f"{config.MPESA_SHORTCODE}{config.MPESA_PASSKEY}{ts}".encode()).decode()


_token_lock = threading.Lock()
_token: tuple[str, float] | None = None


def _request(method: str, path: str, *, body: dict | None = None, headers: dict | None = None) -> dict:
    url = HOSTS[config.MPESA_ENV] + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        text = e.read().decode(errors="replace")
        try:
            return json.loads(text)
        except ValueError:
            raise MpesaError(f"Daraja HTTP {e.code}: {text[:200]}") from e
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        raise MpesaError(f"Could not reach M-Pesa: {e}") from e


def _access_token() -> str:
    global _token
    with _token_lock:
        if _token and _token[1] > time.time() + 60:
            return _token[0]
        creds = base64.b64encode(f"{config.MPESA_CONSUMER_KEY}:{config.MPESA_CONSUMER_SECRET}".encode()).decode()
        data = _request("GET", "/oauth/v1/generate?grant_type=client_credentials",
                        headers={"Authorization": f"Basic {creds}"})
        token = data.get("access_token")
        if not token:
            raise MpesaError("M-Pesa authentication failed. Check consumer key/secret.")
        _token = (token, time.time() + int(data.get("expires_in", 3599)))
        return token


def callback_url() -> str:
    return f"{config.PUBLIC_URL}/api/mpesa/callback/{config.MPESA_CALLBACK_SECRET}"


def stk_push(phone: str, amount: int, account_ref: str, description: str) -> dict:
    """Returns {"MerchantRequestID", "CheckoutRequestID", "CustomerMessage"}."""
    if config.MPESA_ENV == "mock":
        rid = secrets.token_hex(8)
        return {"MerchantRequestID": f"mock-m-{rid}", "CheckoutRequestID": f"ws_CO_mock_{rid}",
                "ResponseCode": "0", "CustomerMessage": "Success. Request accepted for processing (mock)"}
    if len(config.MPESA_CALLBACK_SECRET) < 20 or config.MPESA_CALLBACK_SECRET == "change-me":
        raise MpesaError("Payments are not configured yet (MPESA_CALLBACK_SECRET must be a long random string).")
    ts = _timestamp()
    data = _request("POST", "/mpesa/stkpush/v1/processrequest", headers={"Authorization": f"Bearer {_access_token()}"}, body={
        "BusinessShortCode": config.MPESA_SHORTCODE,
        "Password": _password(ts),
        "Timestamp": ts,
        "TransactionType": config.MPESA_TRANSACTION_TYPE,
        "Amount": int(amount),
        "PartyA": phone,
        "PartyB": config.MPESA_PARTY_B,
        "PhoneNumber": phone,
        "CallBackURL": callback_url(),
        "AccountReference": account_ref[:12],
        "TransactionDesc": description[:13],
    })
    if str(data.get("ResponseCode")) != "0":
        raise MpesaError(data.get("errorMessage") or data.get("ResponseDescription") or "M-Pesa rejected the request.")
    return data


def stk_query(checkout_request_id: str) -> dict:
    """Returns the raw query response. ResultCode "0" = paid; absent while still processing."""
    if config.MPESA_ENV == "mock":
        return {"ResultCode": "0", "ResultDesc": "The service request is processed successfully. (mock)"}
    ts = _timestamp()
    return _request("POST", "/mpesa/stkpushquery/v1/query", headers={"Authorization": f"Bearer {_access_token()}"}, body={
        "BusinessShortCode": config.MPESA_SHORTCODE,
        "Password": _password(ts),
        "Timestamp": ts,
        "CheckoutRequestID": checkout_request_id,
    })


def parse_callback(payload: dict) -> dict:
    """Flatten Daraja's STK callback into {checkout_request_id, result_code, ..., amount, receipt, phone}."""
    cb = (payload.get("Body") or {}).get("stkCallback") or {}
    meta = {i.get("Name"): i.get("Value") for i in (cb.get("CallbackMetadata") or {}).get("Item", []) if isinstance(i, dict)}
    return {
        "checkout_request_id": cb.get("CheckoutRequestID"),
        "merchant_request_id": cb.get("MerchantRequestID"),
        "result_code": str(cb.get("ResultCode")),
        "result_desc": cb.get("ResultDesc") or "",
        "amount": meta.get("Amount"),
        "receipt": meta.get("MpesaReceiptNumber"),
        "phone": str(meta.get("PhoneNumber") or ""),
    }
