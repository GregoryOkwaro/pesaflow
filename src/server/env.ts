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

  PLAN_MONTHLY_KES: int(299),
  PLAN_QUARTERLY_KES: int(799),
  PLAN_YEARLY_KES: int(2999),

  // Payments: mock (local, no money) | sandbox | production
  MPESA_ENV: oneOf(["mock", "sandbox", "production"], "mock"),
  MPESA_CONSUMER_KEY: optStr(),
  MPESA_CONSUMER_SECRET: optStr(),
  MPESA_SHORTCODE: str("174379"),
  MPESA_PASSKEY: optStr(),
  MPESA_TRANSACTION_TYPE: oneOf(["CustomerPayBillOnline", "CustomerBuyGoodsOnline"], "CustomerPayBillOnline"),
  MPESA_PARTY_B: optStr(),
  MPESA_CALLBACK_SECRET: str(""),

  // Messages: mock (logged) | live
  NOTIFY_ENV: oneOf(["mock", "live"], "mock"),
  ZEPTOMAIL_TOKEN: optStr(), // "Zoho-enczapikey ..." send-mail token
  ZEPTOMAIL_API_URL: str("https://api.zeptomail.com/v1.1/email"), // .eu / .in for other data centres
  MAIL_FROM_ADDRESS: str("no-reply@example.co.ke"),
  MAIL_FROM_NAME: str("PesaFlow"),
  AT_USERNAME: optStr(), // "sandbox" for Africa's Talking sandbox
  AT_API_KEY: optStr(),
  AT_SENDER_ID: optStr(),

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
    cached = e;
  }
  return cached;
}

export const PLANS = {
  monthly: { label: "Monthly", days: 30, amount: () => env().PLAN_MONTHLY_KES },
  quarterly: { label: "3 months", days: 91, amount: () => env().PLAN_QUARTERLY_KES },
  yearly: { label: "Yearly", days: 365, amount: () => env().PLAN_YEARLY_KES },
} as const;
export type PlanKey = keyof typeof PLANS;

export function planList() {
  return (Object.keys(PLANS) as PlanKey[]).map((key) => ({ key, label: PLANS[key].label, days: PLANS[key].days, amount: PLANS[key].amount() }));
}

export function isAdminEmail(email: string): boolean {
  return env().ADMIN_EMAILS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}
