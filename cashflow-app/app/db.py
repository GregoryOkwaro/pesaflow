"""SQLite storage. One connection per request; WAL mode for concurrent readers."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name            TEXT NOT NULL,
    phone           TEXT,
    password_hash   TEXT NOT NULL,
    is_admin        INTEGER NOT NULL DEFAULT 0,
    trial_ends_at   TEXT NOT NULL,
    paid_until      TEXT,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS password_resets (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash   TEXT NOT NULL,                         -- HMAC of the code with a per-row salt
    salt        TEXT NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    expires_at  TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

CREATE TABLE IF NOT EXISTS budgets (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    horizon_days  INTEGER NOT NULL DEFAULT 31,
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_budgets_user ON budgets(user_id);

CREATE TABLE IF NOT EXISTS accounts (
    id                INTEGER PRIMARY KEY,
    budget_id         INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    details           TEXT NOT NULL DEFAULT '',
    balance           INTEGER NOT NULL DEFAULT 0,      -- cents
    include_in_total  INTEGER NOT NULL DEFAULT 1,
    sort              INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_accounts_budget ON accounts(budget_id);

CREATE TABLE IF NOT EXISTS items (
    id          INTEGER PRIMARY KEY,
    budget_id   INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    amount      INTEGER NOT NULL DEFAULT 0,            -- cents, +in / -out
    every_days  INTEGER NOT NULL DEFAULT 0,
    value_date  TEXT,
    end_date    TEXT,
    tie_to      INTEGER REFERENCES items(id) ON DELETE SET NULL,
    done        INTEGER NOT NULL DEFAULT 0,
    account_id  INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    note        TEXT NOT NULL DEFAULT '',
    sort        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_budget ON items(budget_id);

CREATE TABLE IF NOT EXISTS payments (
    id                   INTEGER PRIMARY KEY,
    user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan                 TEXT NOT NULL,
    amount               INTEGER NOT NULL,             -- whole KES
    phone                TEXT NOT NULL,
    checkout_request_id  TEXT UNIQUE,
    merchant_request_id  TEXT,
    status               TEXT NOT NULL DEFAULT 'pending', -- pending|success|failed
    result_code          TEXT,
    result_desc          TEXT,
    receipt              TEXT UNIQUE,
    applied              INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
"""


def connect() -> sqlite3.Connection:
    Path(config.DATABASE_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.DATABASE_PATH, timeout=15, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 15000")
    return conn


def init() -> None:
    conn = connect()
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
    finally:
        conn.close()
