# PesaFlow: day-by-day cash flow budget (global SaaS, Kenya first)

A day-by-day cash flow budget built from the GFSN monthly cash flow workbook, sold on subscription:
M-Pesa in Kenya, and cards, PayPal and local payment methods everywhere else.

**Stack:** Next.js 16 (App Router, TypeScript) · PostgreSQL 18 · Drizzle ORM · pg-boss (Postgres job
queue) · Safaricom Daraja (M-Pesa STK push) · Paddle (merchant of record, worldwide) · ZeptoMail
(email) · Africa's Talking (SMS) · Cloudflare (DNS, CDN, firewall, Turnstile).

**Global:** 6 languages (English, Kiswahili, Français, Español, Português, Deutsch) · any currency,
with the correct decimal places · each user's own time zone · international phone numbers · GDPR data
export and account deletion.

```
Cloudflare (DNS · CDN · WAF · Turnstile)
        │
Next.js web (Node, container)  ←→  PostgreSQL 18 (managed, same region)
        │                                 ▲
        └── queues jobs ──►  worker (pg-boss): messages, payment reconciliation,
                                     renewal reminders, housekeeping
                                     │
              Daraja (M-Pesa) · Paddle (cards/PayPal) · ZeptoMail (email) · Africa's Talking (SMS)
```

## Run it locally

Requires Node.js 22+ and Docker.

```bash
npm install
cp .env.example .env          # defaults work locally: mock M-Pesa + Paddle, messages printed to the console
docker compose up -d db       # PostgreSQL 18 on localhost:5433
npm run db:migrate
npm run dev                   # http://localhost:3000
```

With `JOBS_INLINE=1` (the local default), emails and SMS are handled inside the web process, so no
worker is needed. To run jobs the production way, set `JOBS_INLINE=0` and run `npm run worker` too.

Local test accounts (exist only in your local database): `demo@pesaflow.test` / `LocalDevReset-2026`
(Kenya, KES) and `lena@pesaflow.test` / `LocalDevOnly-2026` (Germany, EUR).
In mock mode, reset codes and receipts appear in the `npm run dev` console.

```bash
npm test            # 61 tests: spreadsheet parity, API, billing, Paddle, i18n, currencies, time zones, GDPR
npm run typecheck
npm run build
```

## Project layout

```
src/engine/            spreadsheet logic (pure TS, runs on server or browser) + parity tests
src/i18n/              translations (messages/*.ts), language negotiation, plural rules
src/lib/               dates (time zones), money (minor units, any currency), countries, API client
src/server/db/         Drizzle schema (uuidv7 ids, bigint minor units), connection, migrator
src/server/auth/       argon2id passwords, sessions (HttpOnly cookie, hashed tokens)
src/server/services/   budgets, users (reset, GDPR export/delete), billing (M-Pesa + Paddle), reminders
src/server/payments/   PaymentProvider interface · Daraja · Paddle · mocks · phone numbers
src/server/notify/     ZeptoMail + Africa's Talking delivery
src/server/jobs/       pg-boss queue + worker (reminders at 9am in each user's time zone)
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

## Going global: how it works

| Concern | How the app handles it |
|---|---|
| **Language** | User setting → `pf_locale` cookie → browser `Accept-Language`. Switcher on every page. Emails, SMS, CSV headers and API errors are translated too. TypeScript refuses to build if a language is missing a key; a test checks placeholders match. |
| **Currency** | Each budget has an ISO 4217 currency. Amounts are integers in that currency's *minor units*, so JPY has no decimals and KWD has 3. Formatting follows the user's locale (`1.250,50 EUR` in German). |
| **Time zone** | Each user has an IANA zone (detected at sign-up). "Today", due dates, trial ends and reminder times are all in the user's zone. |
| **Country** | Picked at sign-up (pre-filled from Cloudflare's `CF-IPCountry` or the browser language). Sets the default currency, the phone-number format and the payment options. |
| **Payments** | Kenya: M-Pesa or card. Everywhere else: Paddle checkout (cards, PayPal, Apple/Google Pay, local methods) in the customer's currency. Paddle is the **merchant of record**, so it collects and files VAT/GST/sales tax worldwide. |
| **Phone numbers** | Parsed with libphonenumber in the user's country, stored as E.164. SMS goes only to countries Africa's Talking covers (`AT_SMS_COUNTRIES`); email works everywhere. |
| **Privacy (GDPR/DPA)** | "Download my data" (JSON) and "Delete my account" (cancels any Paddle subscription, then erases everything). Only essential cookies are used, so no cookie banner is needed. |
| **Sanctions** | Iran, North Korea, Cuba, Syria and Russia aren't offered at sign-up, because the payment providers can't serve them (`src/lib/countries.ts`). |

Translations are careful drafts. **Have a native speaker review each language before launch.**

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

### 5. Paddle (cards, PayPal and local methods worldwide)
1. Apply at paddle.com, and confirm they'll onboard your Kenyan business (they review the website and
   your terms, privacy and refund pages, so publish those first).
2. In the **sandbox** dashboard, create a product "PesaFlow" with three **recurring** prices (monthly,
   every 3 months, yearly). Add country price overrides for purchasing-power pricing (e.g. lower in
   India and Brazil).
3. Create a client-side token, an API key, and a notification destination pointing to
   `https://<your domain>/api/paddle/webhook`, with the events `transaction.completed`,
   `subscription.created`, `subscription.updated` and `subscription.canceled`.
4. Set `PADDLE_ENV=sandbox`, `PADDLE_CLIENT_TOKEN`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` and the
   three `PADDLE_PRICE_*` ids. Buy with Paddle's test card, then switch to `production` with live
   values.
5. In Cloudflare, leave `/api/paddle/webhook` unchallenged, the same as the M-Pesa callback.

### 6. ZeptoMail
Verify your sending domain (SPF + DKIM records, which you add in Cloudflare DNS), create a Mail Agent,
copy its **Send Mail token** into `ZEPTOMAIL_TOKEN`, set `MAIL_FROM_ADDRESS` on that domain, and
`NOTIFY_ENV=live`. Use the `.eu` or `.in` API URL if your Zoho account is in that data centre.

### 7. Africa's Talking
Create an app, buy SMS credit, request an alphanumeric sender ID (optional), and set `AT_USERNAME` /
`AT_API_KEY`. Test with `AT_USERNAME=sandbox` first. Reset codes and renewal reminders go by SMS to
users who saved a phone number in a country listed in `AT_SMS_COUNTRIES`; everyone else gets email.

### Production checklist
- [ ] `PUBLIC_URL` is https; `MPESA_CALLBACK_SECRET` is long and random
- [ ] Paddle live: client token, API key, webhook secret and price ids set; a real purchase tested
- [ ] Native-speaker review of every translation in `src/i18n/messages/`
- [ ] `JOBS_INLINE=0` with at least one worker running
- [ ] `NOTIFY_ENV=live` with ZeptoMail and/or Africa's Talking configured
- [ ] Database backups and point-in-time recovery on; restore tested once
- [ ] `ADMIN_EMAILS` set; error monitoring (e.g. Sentry) added
- [ ] Privacy policy, terms and refund policy published (Paddle requires them). ODPC registration and a
      data protection impact assessment (Kenya DPA 2019); GDPR compliance for EU users, including an
      EU representative (Art. 27) once you actively serve the EU
- [ ] Database region chosen for a global audience (e.g. EU region for EU users; see cross-border rules)
- [ ] A lawyer has confirmed your hosting region (cross-border transfer safeguards)

## Next steps
- M-Pesa Ratiba standing orders (auto-renewal)
- Phone-number sign-in with an SMS code
- Import an existing workbook (.xlsx) in this layout
- Alert by SMS when the projection goes negative within N days
- Airtel Money / MTN MoMo (add a `PaymentProvider`)
- Language-prefixed URLs (`/fr`, `/de`, …) with hreflang, for search engines in each language
- Right-to-left languages (Arabic) once there's demand
