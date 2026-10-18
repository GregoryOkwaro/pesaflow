# PesaFlow: monthly cash flow budget (SaaS for Kenya)

A day-by-day cash flow budget built from the GFSN monthly cash flow workbook, sold on subscription
through M-Pesa.

**Stack:** Next.js 16 (App Router, TypeScript) · PostgreSQL 18 · Drizzle ORM · pg-boss (Postgres job
queue) · Safaricom Daraja (M-Pesa STK push) · ZeptoMail (email) · Africa's Talking (SMS) ·
Cloudflare (DNS, CDN, firewall, Turnstile).

```
Cloudflare (DNS · CDN · WAF · Turnstile)
        │
Next.js web (Node, container)  ←→  PostgreSQL 18 (managed, same region)
        │                                 ▲
        └── queues jobs ──►  worker (pg-boss): messages, payment reconciliation,
                                     renewal reminders, housekeeping
                                     │
              Daraja (M-Pesa) · ZeptoMail (email) · Africa's Talking (SMS)
```

## Run it locally

Requires Node.js 22+ and Docker.

```bash
npm install
cp .env.example .env          # defaults work locally: mock M-Pesa, messages printed to the console
docker compose up -d db       # PostgreSQL 18 on localhost:5433
npm run db:migrate
npm run dev                   # http://localhost:3000
```

With `JOBS_INLINE=1` (the local default), emails and SMS are handled inside the web process, so no
worker is needed. To run jobs the production way, set `JOBS_INLINE=0` and run `npm run worker` too.

Local test account (exists only in your local database): `demo@pesaflow.test` / `LocalDevReset-2026`.
In mock mode, reset codes and receipts appear in the `npm run dev` console.

```bash
npm test            # 21 tests: spreadsheet parity + API/billing/reset against Postgres 18 (pesaflow_test DB)
npm run typecheck
npm run build
```

## Project layout

```
src/engine/            spreadsheet logic (pure TS, runs on server or browser) + parity tests
src/lib/               dates (timezone-safe), money (integer cents), browser API client
src/server/db/         Drizzle schema (uuidv7 ids, bigint cents), connection, migrator
src/server/auth/       argon2id passwords, sessions (HttpOnly cookie, hashed tokens)
src/server/services/   budgets, users + password reset, billing, renewal reminders
src/server/payments/   PaymentProvider interface · Daraja · mock · Kenyan phone parsing
src/server/notify/     ZeptoMail + Africa's Talking delivery
src/server/jobs/       pg-boss queue + worker (cron in Africa/Nairobi time)
src/app/api/           route handlers (thin: validate → service → JSON)
src/app/               landing page, auth pages, /app
src/components/        React UI (Overview, Items, Daily grid, Settings, dialogs)
drizzle/               SQL migrations (generated: npm run db:generate)
cashflow-app/          the original zero-dependency Python prototype (reference only)
```

## How the spreadsheet maps to the app

| Workbook | App |
|---|---|
| Account balances `=B34+D34+F34` | Accounts, with "count in cash today" (untick savings) |
| ITEM / AMOUNT / EVERY (DAYS) / VALUE DATE / END DATE | Items (no 31-row limit) |
| `ENTER Y IF DONE` | "Mark as paid" tick |
| `TIE DR TO CR?` | "Wait for income": never lands before the tied income (fixes the sheet's formula bug) |
| 31-day grid, DAY'S NET FLOW, CUM BAL | Daily tab, CSV export, print (7–120 day horizon) |
| `BUDG SUR/DEF`, `BOTTOMLINE` | Surplus/deficit, bottom line, lowest balance, first negative day |

`src/engine/engine.test.ts` checks the engine against the workbook's own calculated values: all 31
days match.

## Security
- Argon2id password hashing. Login takes the same time whether or not the email exists.
- Sessions: 256-bit random tokens stored as SHA-256 hashes; HttpOnly, SameSite=Lax, Secure on https.
- CSRF: state-changing requests need `X-Requested-With: fetch` and a same-site Origin.
- Rate limits stored in Postgres, so they hold across every instance (login, sign-up, reset, payments).
- Every query is scoped to the owner. IDs are UUIDs, and malformed IDs return 404.
- Password reset: 6-digit code, 15 minutes, 5 tries, salted HMAC at rest, the same reply for unknown
  emails, and all sessions revoked on reset.
- Payments: secret callback URL; only settles a pending payment we created; checks the amount paid;
  receipt numbers are unique; settlement row-locks so a callback and a status query can't both
  extend access.
- Optional Cloudflare Turnstile on sign-up and reset (`TURNSTILE_*`).

## Going live

### 1. Database
Use a managed **PostgreSQL 18** in the same region as the app (for example AWS RDS `af-south-1` in
Cape Town, DigitalOcean, Neon or Supabase). Turn on automated backups and point-in-time recovery. The
worker image runs migrations on start.

### 2. App hosting (recommended: Node containers + Cloudflare in front)
```bash
docker build --target web -t pesaflow-web .        # serves port 3000
docker build --target worker -t pesaflow-worker .  # migrations + jobs; run at least 1
```
Run both with the same environment variables (`JOBS_INLINE=0`) on any container host (DigitalOcean
App Platform, Render, Fly.io, AWS ECS). Scale web horizontally; one or two workers are plenty.

### 3. Cloudflare
- Proxy the app's DNS record (orange cloud). Set SSL/TLS to **Full (strict)**.
- Allow only Cloudflare's IP ranges to reach the origin. The app trusts `CF-Connecting-IP` for rate limits.
- Add a WAF rate-limit rule on `/api/auth/*` as an outer layer.
- Optional: create a Turnstile widget and set `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`.
- Leave `/api/mpesa/callback/*` unchallenged (no bot fight or JS challenge), since Safaricom must reach it.

### 4. M-Pesa (Daraja)
1. Create an app at developer.safaricom.co.ke with Lipa Na M-Pesa Online.
2. Sandbox: `MPESA_ENV=sandbox`, sandbox key, secret and passkey, shortcode `174379`, a public https
   `PUBLIC_URL`, and a long random `MPESA_CALLBACK_SECRET`.
3. Go-live through the Daraja portal with your paybill or till, then set `MPESA_ENV=production`. For a
   till: `MPESA_TRANSACTION_TYPE=CustomerBuyGoodsOnline`, `MPESA_PARTY_B=<till>`.
4. Ask Safaricom about **M-Pesa Ratiba** (standing orders) for automatic renewals: the next billing
   feature to add.
5. Underpayments show up as failed payments with "Amount mismatch"; `/api/admin/stats` counts them for
   manual refund or reconciliation.

### 5. ZeptoMail
Verify your sending domain (SPF + DKIM records, which you add in Cloudflare DNS), create a Mail Agent,
copy its **Send Mail token** into `ZEPTOMAIL_TOKEN`, set `MAIL_FROM_ADDRESS` on that domain, and
`NOTIFY_ENV=live`. Use the `.eu` or `.in` API URL if your Zoho account is in that data centre.

### 6. Africa's Talking
Create an app, buy SMS credit, request an alphanumeric sender ID (optional), and set `AT_USERNAME` /
`AT_API_KEY`. Test with `AT_USERNAME=sandbox` first. Reset codes and renewal reminders go by SMS to
users who saved a phone number.

### Production checklist
- [ ] `PUBLIC_URL` is https; `MPESA_CALLBACK_SECRET` is long and random
- [ ] `JOBS_INLINE=0` with at least one worker running
- [ ] `NOTIFY_ENV=live` with ZeptoMail and/or Africa's Talking configured
- [ ] Database backups and point-in-time recovery on; restore tested once
- [ ] `ADMIN_EMAILS` set; error monitoring (e.g. Sentry) added
- [ ] Privacy policy and terms published; ODPC registration and a data protection impact assessment
      (Kenya Data Protection Act 2019): you store people's financial data
- [ ] A lawyer has confirmed your hosting region (cross-border transfer safeguards)

## Next steps
- M-Pesa Ratiba standing orders (auto-renewal)
- Phone-number sign-in with an SMS code
- Import an existing workbook (.xlsx) in this layout
- Alert by SMS when the projection goes negative within N days
- Airtel Money and other countries (add a `PaymentProvider`)
- Swahili translation
