import { z } from "zod";

// Blank values in .env mean "not set" (use the default).
const blank = (v: string | undefined) => v === undefined || v.trim() === "";
const optStr = () => z.string().optional().transform((v) => (blank(v) ? undefined : v!.trim()));
const str = (def: string) => z.string().optional().transform((v) => (blank(v) ? def : v!.trim()));
const int = (def: number) => z.string().optional().transform((v, ctx) => {
  if (blank(v)) return def;
  const n = Number(v);
  if (!Number.isInteger(n)) { ctx.addIssue({ code: "custom", message: "must be a whole number" }); return z.NEVER; }
  return n;
});
const oneOf = <const T extends readonly [string, ...string[]]>(values: T, def: T[number]) =>
  z.string().optional().transform((v, ctx) => {
    if (blank(v)) return def;
    if (!values.includes(v!.trim())) { ctx.addIssue({ code: "custom", message: `must be one of ${values.join(", ")}` }); return z.NEVER; }
    return v!.trim() as T[number];
  });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_NAME: str("PesaFlow"),
  PUBLIC_URL: str("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SESSION_DAYS: int(30),
  TRIAL_DAYS: int(14),
  ADMIN_EMAILS: str(""),
  MAX_BUDGETS_PER_USER: int(10),
  MAX_ITEMS_PER_BUDGET: int(200),

  // M-Pesa (Kenya) prices in whole KES.
  PLAN_MONTHLY_KES: int(299),
  PLAN_QUARTERLY_KES: int(799),
  PLAN_YEARLY_KES: int(2999),
  // Display prices for everyone else (marketing + plan picker). The amount actually charged,
  // including local-currency and tax, comes from the Paddle price (set PPP overrides there).
  PLAN_MONTHLY_USD: str("3"),
  PLAN_QUARTERLY_USD: str("8"),
  PLAN_YEARLY_USD: str("29"),

  // Card / PayPal / local methods worldwide via Paddle (merchant of record).
  PADDLE_ENV: oneOf(["mock", "sandbox", "production"], "mock"),
  PADDLE_CLIENT_TOKEN: optStr(), // public, for Paddle.js
  PADDLE_API_KEY: optStr(), // server-side, to cancel subscriptions on account deletion
  PADDLE_WEBHOOK_SECRET: optStr(), // notification destination's secret key
  PADDLE_PRICE_MONTHLY: optStr(),
  PADDLE_PRICE_QUARTERLY: optStr(),
  PADDLE_PRICE_YEARLY: optStr(),

  // Payments: mock (local, no money) | sandbox | production
  MPESA_ENV: oneOf(["mock", "sandbox", "production"], "mock"),
  MPESA_CONSUMER_KEY: optStr(),
  MPESA_CONSUMER_SECRET: optStr(),
  MPESA_SHORTCODE: str("174379"),
  MPESA_PASSKEY: optStr(),
  MPESA_TRANSACTION_TYPE: oneOf(["CustomerPayBillOnline", "CustomerBuyGoodsOnline"], "CustomerPayBillOnline"),
  MPESA_PARTY_B: optStr(),
  MPESA_CALLBACK_SECRET: str(""),

  // MTN MoMo, Airtel Money and other African mobile money via Flutterwave (prepaid, local currency).
  // Flutterwave is not a merchant of record: you are the seller and handle local tax.
  FLW_ENV: oneOf(["mock", "test", "live"], "mock"), // test = Flutterwave test-mode keys
  FLW_SECRET_KEY: optStr(), // FLWSECK-... (server only)
  FLW_WEBHOOK_HASH: optStr(), // "Secret hash" set on the webhook in the Flutterwave dashboard
  FLW_PRICES: optStr(), // optional JSON overrides, major units: {"UGX":[11000,29000,105000]}
  FLW_COUNTRIES: optStr(), // optional allow-list, e.g. "UG,RW,TZ" (default: all in mobileMoney.ts)

  // Messages: mock (logged) | live
  NOTIFY_ENV: oneOf(["mock", "live"], "mock"),
  ZEPTOMAIL_TOKEN: optStr(), // "Zoho-enczapikey ..." send-mail token
  ZEPTOMAIL_API_URL: str("https://api.zeptomail.com/v1.1/email"), // .eu / .in for other data centres
  MAIL_FROM_ADDRESS: str("no-reply@example.co.ke"),
  MAIL_FROM_NAME: str("PesaFlow"),
  AT_USERNAME: optStr(), // "sandbox" for Africa's Talking sandbox
  AT_API_KEY: optStr(),
  AT_SENDER_ID: optStr(),
  // Countries Africa's Talking delivers SMS to; elsewhere messages go by email only.
  AT_SMS_COUNTRIES: str("KE,UG,TZ,RW,MW,NG,ZM,ET,CI,CM,SN,GH,ZA"),

  // Cloudflare Turnstile (bot check on sign-up / reset). Optional.
  TURNSTILE_SITE_KEY: optStr(),
  TURNSTILE_SECRET_KEY: optStr(),

  RESET_CODE_MINUTES: int(15),
  RESET_MAX_ATTEMPTS: int(5),
  RENEWAL_REMINDER_DAYS: int(3),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Parsed lazily so `next build` works without production secrets. */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error("Invalid environment:\n" + parsed.error.issues.map((i) => ` - ${i.path.join(".")}: ${i.message}`).join("\n"));
    }
    const e = parsed.data;
    if (e.MPESA_ENV !== "mock" && e.MPESA_CALLBACK_SECRET.length < 20) {
      throw new Error("MPESA_CALLBACK_SECRET must be a long random string when MPESA_ENV is sandbox/production.");
    }
    if (e.PADDLE_ENV !== "mock" && (!e.PADDLE_WEBHOOK_SECRET || !e.PADDLE_CLIENT_TOKEN)) {
      throw new Error("PADDLE_CLIENT_TOKEN and PADDLE_WEBHOOK_SECRET are required when PADDLE_ENV is sandbox/production.");
    }
    if (e.FLW_ENV !== "mock" && (!e.FLW_SECRET_KEY || !e.FLW_WEBHOOK_HASH || e.FLW_WEBHOOK_HASH.length < 20)) {
      throw new Error("FLW_SECRET_KEY and a long random FLW_WEBHOOK_HASH are required when FLW_ENV is test/live.");
    }
    cached = e;
  }
  return cached;
}

export const PLAN_KEYS = ["monthly", "quarterly", "yearly"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];
export const PLAN_DAYS: Record<PlanKey, number> = { monthly: 30, quarterly: 91, yearly: 365 };
export const isPlan = (p: unknown): p is PlanKey => typeof p === "string" && (PLAN_KEYS as readonly string[]).includes(p);

/** M-Pesa price in KES minor units (cents). */
export function mpesaPrice(plan: PlanKey): number {
  const e = env();
  return { monthly: e.PLAN_MONTHLY_KES, quarterly: e.PLAN_QUARTERLY_KES, yearly: e.PLAN_YEARLY_KES }[plan] * 100;
}

export function paddlePriceId(plan: PlanKey): string | undefined {
  const e = env();
  return { monthly: e.PADDLE_PRICE_MONTHLY, quarterly: e.PADDLE_PRICE_QUARTERLY, yearly: e.PADDLE_PRICE_YEARLY }[plan];
}

/** Plan picker data for the browser. */
export function planList() {
  const e = env();
  const usd = { monthly: e.PLAN_MONTHLY_USD, quarterly: e.PLAN_QUARTERLY_USD, yearly: e.PLAN_YEARLY_USD };
  return PLAN_KEYS.map((key) => ({
    key,
    days: PLAN_DAYS[key],
    kes: mpesaPrice(key), // minor units
    usd: Math.round(Number(usd[key]) * 100), // minor units, display only
    paddlePriceId: paddlePriceId(key) ?? null,
  }));
}

/** Public client config for checkout. */
export function paymentConfig() {
  const e = env();
  return {
    mpesaEnv: e.MPESA_ENV,
    paddleEnv: e.PADDLE_ENV,
    paddleClientToken: e.PADDLE_CLIENT_TOKEN ?? null,
    mobileMoneyEnv: e.FLW_ENV,
    cardEnabled: e.PADDLE_ENV === "mock" || PLAN_KEYS.every((k) => !!paddlePriceId(k)),
  };
}

export function isAdminEmail(email: string): boolean {
  return env().ADMIN_EMAILS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}
