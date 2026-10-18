# PesaFlow — Monthly Cash Flow Budget (SaaS)

A multi-user web app built from the `GFSN-MONTHLY_CASH_FLOW_BUDGET` Excel workbook, sold as a
subscription paid through M-Pesa (Daraja STK push).

## From spreadsheet to app

| Workbook | App |
|---|---|
| Row 34 balances (M, E, O) `=B34+D34+F34` | **Accounts**, with a "count in cash today" switch (savings unticked, per the sheet's note) |
| Rows 36–66: ITEM, AMOUNT (+/−), EVERY (DAYS), VALUE DATE, END DATE | **Items** (no 31-row limit) |
| `ENTER Y IF DONE` → `N = IF(K="Y",0,C)` | "Mark as paid" tick: the item stops counting |
| `TIE DR TO CR?` + column O rule | "Wait for income": a payment never lands before the income it's tied to |
| Overdue/blank dates → `TODAY()` | Same: past-due items count as due today |
| Rows 1–33 occurrence schedule | Generated (no 32-occurrence cap) |
| 31-day grid, `DAY'S NET FLOW`, `CUM BAL` | **Daily** tab (same columns), CSV export, print |
| `BUDG SUR/DEF`, `BOTTOMLINE` | Overview cards: surplus/deficit, bottom line, lowest balance, first day you go negative |
| Free text like "PAID 05/10/26" typed in the amount cell | Proper paid flag + a **Note** field |

`tests/test_engine.py` checks the engine against the workbook's own calculated values (16 Oct 2026,
anonymised): all 31 days match to the shilling.

### Things fixed from the spreadsheet

1. **`J34` "BUDG SUR/DEF"** reads column 34 of `P:AX`, which is the last day's *net flow* (AW), not the
   balance (AX). It showed −2,250 when the real closing position was −61,458. The app reports both
   properly.
2. **Tie rule.** Column O swaps in the tied credit's date even when the debit is due *later*. The cell
   comment says "if date less than tied to, tied to; else date", so the app uses the later of the two.
3. Item lookups used `VLOOKUP` on the item **name**, so two items with the same name broke each other.
   The app uses IDs.
4. Text in the amount column was silently treated as 0. The app requires a number and keeps notes separately.

## Features

- Sign up / log in (email + password, PBKDF2-SHA256, HttpOnly session cookies)
- Forgot password: 6-digit code by email and/or SMS (see "Password reset" below)
- Several budgets per user, "copy this budget" to roll into next month
- Projection horizon of 7–120 days (default 31, as in the sheet)
- Mobile-first, works on any phone browser, installable as a PWA, light/dark mode
- 14-day free trial, then **read-only** until paid. Users never lose data.
- Plans: monthly / 3 months / yearly via **M-Pesa STK push**. Paying early adds days on top.
- Admin stats at `GET /api/admin/stats` for emails listed in `ADMIN_EMAILS`

## Run locally

Requires Python 3.10+. No third-party packages.

```bash
cp .env.example .env
python run.py
```

Open http://localhost:8000. With `MPESA_ENV=mock`, payments succeed instantly and no money moves.

Local test account (created during development; only exists in your local `data/` database):
`demo@pesaflow.test` / `LocalDevReset-2026` (changed by testing the reset flow).
In mock mode, reset codes appear in the server log.

```bash
python -m unittest discover -s tests -t .
```

## Going live with M-Pesa

1. Create an app at https://developer.safaricom.co.ke and enable **Lipa Na M-Pesa Online**.
2. Test in sandbox: `MPESA_ENV=sandbox`, sandbox consumer key/secret, shortcode `174379` and the
   sandbox passkey. `PUBLIC_URL` must be a public **https** URL (for example an ngrok tunnel) so
   Safaricom can reach `/api/mpesa/callback/<MPESA_CALLBACK_SECRET>`.
3. Go-live: apply via the Daraja portal with your paybill or till, then switch to
   `MPESA_ENV=production` with production credentials and passkey. For a till, set
   `MPESA_TRANSACTION_TYPE=CustomerBuyGoodsOnline` and `MPESA_PARTY_B=<till>`.

How payments are confirmed:

- Safaricom posts the result to a secret callback URL. The app only accepts it for a pending payment
  it created, checks the amount paid, and applies each payment exactly once (receipt numbers are unique).
- If the callback is late or lost, the app asks Daraja directly (STK query) while the customer waits.
- Underpayments are marked failed. The M-Pesa receipt is kept so you can reconcile or refund by hand.

## Password reset

"Forgot password?" on the login screen sends a 6-digit code. It expires after 15 minutes and allows
5 wrong tries. Entering it with a new password logs the user in and signs them out on every other
device.

- `NOTIFY_ENV=live` sends the code by **email** (SMTP) and, when the user saved a phone number, by
  **SMS** through Africa's Talking. Configure at least one of them. The server prints a warning at
  startup if neither is set.
- The reply is identical whether or not the email has an account, so the form can't be used to find
  out who your customers are. Requests are rate-limited per IP and per email (3 an hour).
- Only a salted hash of each code is stored, and requesting a new code cancels the old one.

## Deploying

```bash
docker build -t pesaflow .
docker run -d -p 8000:8000 --env-file .env -v pesaflow-data:/data pesaflow
```

Put it behind nginx or Caddy for HTTPS. Production checklist:

- [ ] HTTPS only (`PUBLIC_URL=https://…`). Session cookies become `Secure` automatically.
- [ ] Long random `MPESA_CALLBACK_SECRET`. Optionally allow only Safaricom's IPs on `/api/mpesa/callback/`.
- [ ] The proxy must **overwrite** `X-Forwarded-For`, since login rate limiting keys on it.
- [ ] Back up `/data/cashflow.db` daily (`sqlite3 cashflow.db ".backup backup.db"`).
- [ ] Add a privacy policy and terms, and register with the ODPC under Kenya's Data Protection Act 2019:
      you are storing people's financial data.
- [ ] `NOTIFY_ENV=live` with SMTP and/or Africa's Talking configured. In mock mode reset codes go to the log.

SQLite with WAL handles thousands of users on one server. To scale beyond one machine, move to
PostgreSQL. All SQL is in `app/web.py` and `app/billing.py`.

## Layout

```
app/engine.py    the spreadsheet logic (pure, tested)
app/web.py       WSGI app: routes, auth, validation, serializers
app/billing.py   trial/subscription rules, payment state machine
app/mpesa.py     Daraja client (OAuth, STK push, STK query, callback parsing)
app/db.py        SQLite schema
app/notify.py    reset-code delivery (SMTP email, Africa's Talking SMS, mock)
static/          single-page frontend (no build step)
tests/           engine parity + API/billing tests
```

## Next steps

- Import an existing workbook in this layout (.xlsx upload)
- SMS/WhatsApp alert when the projection goes negative within N days
- Per-account projected balances, and transfers between your own accounts (the sheet's A/C FROM / A/C TO columns)
- Swahili translation
