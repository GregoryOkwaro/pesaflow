"""Password hashing, session tokens and a small in-memory rate limiter."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import threading
import time

PBKDF2_ITERATIONS = 310_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return "pbkdf2_sha256${}${}${}".format(
        PBKDF2_ITERATIONS, base64.b64encode(salt).decode(), base64.b64encode(dk).decode()
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_b64, hash_b64 = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt_b64), int(iters))
        return hmac.compare_digest(dk, base64.b64decode(hash_b64))
    except (ValueError, TypeError):
        return False


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_reset_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_reset_code(code: str) -> tuple[str, str]:
    """Returns (salt, hash). Codes are short-lived and attempt-limited; the salt
    stops a leaked table from being matched against one precomputed list."""
    salt = secrets.token_hex(16)
    return salt, hmac.new(salt.encode(), code.encode(), hashlib.sha256).hexdigest()


def verify_reset_code(code: str, salt: str, stored: str) -> bool:
    return hmac.compare_digest(hmac.new(salt.encode(), code.encode(), hashlib.sha256).hexdigest(), stored)


class RateLimiter:
    """Sliding-window limiter keyed by e.g. IP or email. Per-process only;
    put a shared limiter (nginx limit_req, Redis) in front when scaling out."""

    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            hits = [t for t in self._hits.get(key, []) if now - t < self.window]
            if len(hits) >= self.limit:
                self._hits[key] = hits
                return False
            hits.append(now)
            self._hits[key] = hits
            return True
