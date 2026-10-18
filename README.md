# PesaFlow: day-by-day cash flow budget (global SaaS, Kenya first)

A day-by-day cash flow budget built from the GFSN monthly cash flow workbook, sold on subscription:
M-Pesa in Kenya, MTN MoMo, Airtel Money and other mobile money across Africa, and cards, PayPal and
local payment methods everywhere else.

**Stack:** Next.js 16 (App Router, TypeScript) · PostgreSQL 18 · Drizzle ORM · pg-boss (Postgres job
queue) · Safaricom Daraja (M-Pesa STK push) · Flutterwave (mobile money) · Paddle (merchant of record, worldwide) · ZeptoMail
(email) · Africa's Talking (SMS) · Cloudflare (DNS, CDN, firewall, Turnstile).

**Global:** 26 languages, including right-to-left Arabic and Urdu · any currency, with the correct
decimal places · each user's own time zone · international phone numbers · GDPR data export and
account deletion.

```
Cloudflare (DNS · CDN · WAF · Turnstile)
        │
Next.js web (Node, container)  ←→  PostgreSQL 18 (managed, same region)
        │                                 ▲
        └── queues jobs ──►  worker (pg-boss): messages, payment reconciliation,
                                     renewal reminders, housekeeping
                                     │
   Daraja (M-Pesa) · Flutterwave (MoMo/Airtel) · Paddle (cards/PayPal) · ZeptoMail (email) · Africa's Talking (SMS)
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
(Kenya, KES), `lena@pesaflow.test` / `LocalDevOnly-2026` (Germany, EUR) and
`okello@pesaflow.test` / `LocalDevOnly-2026` (Uganda, UGX: try mobile money).
In mock mode, reset codes and receipts appear in the `npm run dev` console.

```bash
npm test            # 141 tests: spreadsheet parity, API, billing, Paddle, mobile money, 26 languages, currencies, time zones, GDPR
npm run typecheck
npm run build
```

## Project layout

```
src/engine/            spreadsheet logic (pure TS, runs on server or browser) + parity tests
src/i18n/              core.ts (browser-safe engine) · translate.ts (server, all dictionaries) · messages/*.ts
src/lib/               dates (time zones), money (minor units, any currency), countries, API client
src/server/db/         Drizzle schema (uuidv7 ids, bigint minor units), connection, migrator
src/server/auth/       argon2id passwords, sessions (HttpOnly cookie, hashed tokens)
src/server/services/   budgets, users (reset, GDPR export/delete), billing (M-Pesa, mobile money, Paddle), reminders
src/server/payments/   PaymentProvider interface · Daraja · Flutterwave · Paddle · mocks · phone numbers
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
| **Language** | 26 languages (see below). User setting → `pf_locale` cookie → browser `Accept-Language` (`zh-TW`/`zh-HK` → Traditional Chinese). Switcher on every page. Emails, SMS, CSV headers and API errors are translated too. TypeScript refuses to build if a language is missing a key; tests check placeholders and plural forms. Browsers download only their own language. |
| **Right-to-left** | Arabic and Urdu set `<html dir="rtl">`. The stylesheet uses logical properties (`inline-start`, `text-align: start`), so the whole layout mirrors. Amounts and phone numbers stay left-to-right, charts keep time running left to right, and emails render right-to-left. |
| **Plurals** | Full CLDR rules per language: Arabic has six forms, Russian, Ukrainian and Polish four, and Chinese, Japanese, Korean, Thai, Vietnamese and Indonesian one. |
| **Typing numbers** | Input follows the user's locale: `1.250,50` (German, French, Spanish, Indonesian…), `1,250.50` (English, Hindi…), Arabic-Indic digits `١٢٥٠`, full-width digits `１２５０` from Chinese and Japanese keyboards, Devanagari, Bengali and Thai digits. |
| **Currency** | Each budget has an ISO 4217 currency. Amounts are integers in that currency's *minor units*, so JPY has no decimals and KWD has 3. Formatting follows the user's locale (`1.250,50 EUR` in German). |
| **Time zone** | Each user has an IANA zone (detected at sign-up). "Today", due dates, trial ends and reminder times are all in the user's zone. |
| **Location** | From the visitor's IP via Cloudflare's `CF-IPCountry` header: no GPS prompt (a location permission request on a finance site scares people off, and the country is all we need). Falls back to the browser's language region. Time zone comes from the device. |
| **Country** | Pre-filled at sign-up from the location above; editable. Sets the budget currency, phone format, price display and payment options. |
| **Language choice** | The language set on the person's phone or browser wins (e.g. most Kenyans and Indians browse in English). The country is used only if that language isn't supported, and to offer the local one in a one-tap banner written in that language ("PesaFlow हिन्दी में भी उपलब्ध है"). It never switches language on its own. |
| **Budget currency** | Always the user's local currency (INR in India, KES in Kenya). People budget in the money they earn and spend, never in USD. Changeable per budget. |
| **Prices** | Kenya: exact KES for M-Pesa. Elsewhere: the USD list price with **≈ local** underneath at today's rate (daily from open.er-api.com, display only). When Paddle is live, the browser swaps in Paddle's **exact** local price including tax (`PricePreview`), so the ≈ figure is only a fallback. |
| **Mobile money** | Uganda, Rwanda, Zambia (MTN MoMo, Airtel Money), Tanzania (Airtel Money, Vodacom M-Pesa, Mixx by Yas, HaloPesa), Ghana (MTN MoMo, Telecel Cash, AirtelTigo Money), Cameroon, Côte d'Ivoire, Senegal (MTN MoMo, Orange Money, Moov) through Flutterwave's hosted checkout. Prepaid plans at round local prices (`src/server/payments/mobileMoney.ts`, override with `FLW_PRICES`); a third "Mobile money" tab in the plan dialog. Flutterwave is **not** a merchant of record: you are the seller and handle local tax. |
| **Payments** | Kenya: M-Pesa or card. Everywhere else: Paddle checkout (cards everywhere, PayPal, Apple/Google Pay except India and Turkey, UPI in India, Pix in Brazil, Alipay/WeChat Pay in China, iDEAL, Bancontact, BLIK, MB WAY, KakaoPay/Naver Pay). "Ways to pay in {country}" is shown before checkout. Paddle is the **merchant of record**, so it collects and files VAT/GST/sales tax worldwide. |
| **Phone numbers** | Parsed with libphonenumber in the user's country, stored as E.164. SMS goes only to countries Africa's Talking covers (`AT_SMS_COUNTRIES`); email works everywhere. |
| **Privacy (GDPR/DPA)** | "Download my data" (JSON) and "Delete my account" (cancels any Paddle subscription, then erases everything). Only essential cookies are used, so no cookie banner is needed. |
| **Sanctions** | Iran, North Korea, Cuba, Syria and Russia aren't offered at sign-up, because the payment providers can't serve them (`src/lib/countries.ts`). |

### Languages

| | |
|---|---|
| Europe | English, Deutsch, Español, Français, Italiano, Nederlands, Polski, Português, Русский, Українська, Türkçe |
| Middle East and South Asia | العربية (RTL), اردو (RTL), हिन्दी, বাংলা |
| East and Southeast Asia | 简体中文, 繁體中文, 日本語, 한국어, Bahasa Indonesia, Tiếng Việt, ไทย |
| Africa | Kiswahili, አማርኛ (Amharic), Hausa, Yorùbá |

To add a language: copy `src/i18n/messages/en.ts`, translate it, and register it in `core.ts` and
`translate.ts`. The build will show anything missing.

Translations are careful drafts. **Have a native speaker review each language before launch**:
Amharic, Hausa and Yoruba first (lowest confidence), then Arabic and Urdu (right-to-left wording and
tone), then the rest. Persian and Hebrew are intentionally not included yet: Persian because Iran is
excluded for sanctions, Hebrew until there's demand. Both would work like Arabic (right-to-left is
already supported).

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
Use a managed **PostgreSQL 18** (required: the schema uses `uuidv7()`) in the same region as the app (for example AWS RDS `af-south-1` in
Cape Town, DigitalOcean, Neon or Supabase). Turn on automated backups and point-in-time recovery. The
worker image runs migrations on start.

### 2. App hosting (recommended: Node containers + Cloudflare in front)
```bash
docker build -t pesaflow-web .                           # serves port 3000
docker build -f Dockerfile.worker -t pesaflow-worker .   # migrations + jobs; run at least 1
```
Run both with the same environment variables (`JOBS_INLINE=0`) on any container host (DigitalOcean
App Platform, Render, Fly.io, AWS ECS). Scale web horizontally; one or two workers are plenty.

**Quickest: Render (recommended to start).** `render.yaml` sets up the website, the worker and a
managed PostgreSQL 18 database in Frankfurt in one go (about USD 20/month on the smallest paid sizes):
1. Put the code in a private GitHub repository.
2. At render.com, sign up with GitHub and add a payment card.
3. **New → Blueprint**, pick the repository, then **Apply**. The first deploy takes about 10 minutes.
4. Open the `pesaflow` service's `https://….onrender.com` address. The app uses it automatically
   (`RENDER_EXTERNAL_URL`); set `PUBLIC_URL` on both services once you have your own domain.

Everything starts in mock mode (`MPESA_ENV`, `FLW_ENV`, `PADDLE_ENV`, `NOTIFY_ENV`): sign-ups work, but
"payments" are simulated and anyone can unlock a plan for free, and reset codes only appear in the
Render logs. Switch each one to live under **Environment** once that account is approved.
Not suitable: Cloudflare Workers (no long-running worker, no native argon2) and shared web hosting
(no Node.js / PostgreSQL 18). A plain VPS works, but you then run updates, backups and security yourself.

### 3. Cloudflare
- Proxy the app's DNS record (orange cloud). Set SSL/TLS to **Full (strict)**.
- Allow only Cloudflare's IP ranges to reach the origin. The app trusts `CF-Connecting-IP` for rate limits.
- Add a WAF rate-limit rule on `/api/auth/*` as an outer layer.
- Optional: create a Turnstile widget and set `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`.
- Leave `/api/mpesa/callback/*`, `/api/paddle/webhook` and `/api/flutterwave/webhook` unchallenged (no bot
  fight or JS challenge), since Safaricom, Paddle and Flutterwave must reach them.

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
6. **Local prices:** on each price, add country overrides in local currency for your main markets
   (e.g. INR for India, BRL for Brazil, priced for local purchasing power) so customers are charged
   in their own currency. Paddle charges in about 33 currencies (call `GET /currencies` for the
   live list). Elsewhere, for example Kenya and Nigeria, cards are charged in USD.
7. **Local payment methods:** in Paddle → Checkout settings, switch on UPI (India), Pix (Brazil),
   Alipay/WeChat Pay (China), iDEAL, Bancontact, BLIK and MB WAY. Some are early access or need
   approval. Then update `src/server/payments/methods.ts` to match what you enabled.

### 6. Flutterwave (MTN MoMo, Airtel Money and other mobile money)
1. Open a Flutterwave business account for your Kenyan company and confirm with Flutterwave which
   collection countries they'll enable for it (Uganda, Tanzania, Rwanda, Zambia, Ghana, Francophone
   Africa). Restrict the app to those with `FLW_COUNTRIES=UG,TZ,...`.
2. **Tax first:** Flutterwave isn't a merchant of record. Once your sales in a country pass its
   threshold you may need to register for VAT / digital services tax there (Uganda, Tanzania, Ghana,
   Rwanda, Zambia and others tax foreign digital services). Ask your accountant before switching a
   country on.
3. In the dashboard (test mode first): Settings → Webhooks → URL
   `https://<your domain>/api/flutterwave/webhook`, a long random **Secret hash** (same value in
   `FLW_WEBHOOK_HASH`), and enable webhook retries. Both `verif-hash` and `flutterwave-signature`
   headers are accepted.
4. Set `FLW_ENV=test` and `FLW_SECRET_KEY` (test `FLWSECK_TEST-…`), pay with Flutterwave's test
   mobile money numbers, then switch to `FLW_ENV=live` with live keys.
5. Prices are fixed per currency in `src/server/payments/mobileMoney.ts` (≈ USD 3 / 8 / 29). Change
   them with `FLW_PRICES='{"UGX":[11000,29000,105000]}'` (monthly, quarterly, yearly, major units).
6. How a payment settles: the app creates a pending payment, sends the customer to Flutterwave's
   hosted page (they pick MTN/Airtel/… and approve on their phone), and Flutterwave returns them to
   `/app?momo=<id>`. Access is extended only after Flutterwave's API confirms the payment **and** the
   amount and currency match, whether that's via the webhook, the dialog's polling or the worker's
   per-minute reconciliation. Replays are harmless; underpayments are recorded as failed with
   "Amount mismatch" for manual review; a payment confirmed after the one-hour timeout still applies.
7. Mobile money here is prepaid (no automatic renewal): the renewal reminder brings customers back.

### 7. ZeptoMail
Verify your sending domain (SPF + DKIM records, which you add in Cloudflare DNS), create a Mail Agent,
copy its **Send Mail token** into `ZEPTOMAIL_TOKEN`, set `MAIL_FROM_ADDRESS` on that domain, and
`NOTIFY_ENV=live`. Use the `.eu` or `.in` API URL if your Zoho account is in that data centre.

### 8. Africa's Talking
Create an app, buy SMS credit, request an alphanumeric sender ID (optional), and set `AT_USERNAME` /
`AT_API_KEY`. Test with `AT_USERNAME=sandbox` first. Reset codes and renewal reminders go by SMS to
users who saved a phone number in a country listed in `AT_SMS_COUNTRIES`; everyone else gets email.

### Production checklist
- [ ] `PUBLIC_URL` is https; `MPESA_CALLBACK_SECRET` is long and random
- [ ] Paddle live: client token, API key, webhook secret and price ids set; a real purchase tested
- [ ] Flutterwave live: secret key and webhook hash set, `FLW_COUNTRIES` limited to what's enabled on
      your account, tax registration checked per country, a real MoMo payment tested
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
- Mobile money in Nigeria (bank transfer / USSD via Flutterwave) and Malawi, once confirmed on your account
- Language-prefixed URLs (`/fr`, `/de`, …) with hreflang, for search engines in each language
- Professional translation review, then a translation platform (Crowdin/Lokalise) for ongoing updates
- More languages on demand: Tamil, Telugu, Marathi, Persian (Afghanistan), Hebrew, Filipino
