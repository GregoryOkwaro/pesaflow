/**
 * Paddle Billing (merchant of record) for card, PayPal and local payment methods
 * worldwide. Paddle sells the subscription to the customer and handles VAT/GST/
 * sales tax; we listen to its webhooks and extend access accordingly.
 *
 * Checkout runs in the browser with Paddle.js (overlay); the server only needs
 * webhooks (verified by HMAC signature) and, for account deletion, the API.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env";

const API = { sandbox: "https://sandbox-api.paddle.com", production: "https://api.paddle.com" } as const;
const MAX_SKEW_SECONDS = 5 * 60;

/** Verifies `Paddle-Signature: ts=1700000000;h1=<hex hmac-sha256 of "ts:rawBody">`. */
export function verifyPaddleSignature(rawBody: string, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(";").map((kv) => kv.split("=", 2) as [string, string]));
  const ts = Number(parts.ts);
  const h1 = parts.h1;
  if (!ts || !h1 || Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(h1, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signPaddlePayload(rawBody: string, secret: string, ts = Math.floor(Date.now() / 1000)): string {
  return `ts=${ts};h1=${createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex")}`;
}

// ---- the subset of Paddle's event payloads we use

export interface PaddleEvent {
  event_id: string;
  event_type: string;
  occurred_at: string;
  data: Record<string, unknown>;
}

export interface PaddleTransaction {
  id: string;
  status: string;
  customerId: string | null;
  subscriptionId: string | null;
  userId: string | null; // from custom_data
  plan: string | null; // from custom_data
  currency: string;
  totalMinor: number; // grand total in minor units, as Paddle reports it
  periodEndsAt: string | null; // ISO timestamp
}

export interface PaddleSubscription {
  id: string;
  status: string; // active | trialing | past_due | paused | canceled
  customerId: string | null;
  userId: string | null;
  periodEndsAt: string | null;
  scheduledCancel: boolean;
  manageUrl: string | null;
  cancelUrl: string | null;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function parseTransaction(data: Record<string, unknown>): PaddleTransaction {
  const custom = obj(data.custom_data);
  const totals = obj(obj(data.details).totals);
  return {
    id: String(data.id),
    status: String(data.status ?? ""),
    customerId: str(data.customer_id),
    subscriptionId: str(data.subscription_id),
    userId: str(custom.userId),
    plan: str(custom.plan),
    currency: String(data.currency_code ?? "USD"),
    totalMinor: Number(totals.grand_total ?? totals.total ?? 0) || 0,
    periodEndsAt: str(obj(data.billing_period).ends_at),
  };
}

export function parseSubscription(data: Record<string, unknown>): PaddleSubscription {
  const custom = obj(data.custom_data);
  const urls = obj(data.management_urls);
  return {
    id: String(data.id),
    status: String(data.status ?? ""),
    customerId: str(data.customer_id),
    userId: str(custom.userId),
    periodEndsAt: str(obj(data.current_billing_period).ends_at),
    scheduledCancel: obj(data.scheduled_change).action === "cancel",
    manageUrl: str(urls.update_payment_method),
    cancelUrl: str(urls.cancel),
  };
}

/** Cancels immediately (used when a user deletes their account). No-op in mock mode. */
export async function cancelSubscriptionNow(subscriptionId: string): Promise<void> {
  const e = env();
  if (e.PADDLE_ENV === "mock") return;
  if (!e.PADDLE_API_KEY) throw new Error("PADDLE_API_KEY is required to cancel subscriptions");
  const res = await fetch(`${API[e.PADDLE_ENV]}/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${e.PADDLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ effective_from: "immediately" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.ok || res.status === 404) return;
  // Already-canceled subscriptions return a 400 mentioning "canceled"; that's fine.
  const text = await res.text();
  if (!/canceled/i.test(text)) throw new Error(`Paddle cancel failed: HTTP ${res.status} ${text.slice(0, 200)}`);
}
