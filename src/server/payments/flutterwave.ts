/**
 * Flutterwave (v3 API) for mobile money across Africa: MTN MoMo, Airtel Money,
 * Vodacom M-Pesa (TZ), Orange Money and others.
 *
 * Flow: we create a hosted checkout (Flutterwave Standard) with our own tx_ref,
 * send the customer there to pick their network and approve on their phone,
 * and settle when the signed webhook arrives or our status query (verify by
 * reference) says so. Either way the amount and currency are checked against
 * what we asked for before access is extended.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { currencyExponent } from "@/lib/money";
import { db, schema } from "../db";
import { env } from "../env";
import { PaymentError, type CallbackResult, type PaymentProvider, type StartPaymentInput, type StatusResult } from "./types";

const API = "https://api.flutterwave.com/v3";

/** Our tx_ref for a payment row. Unique per payment, known before we call Flutterwave. */
export const txRef = (paymentId: string) => `pf_${paymentId}`;

const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

/**
 * Accepts either Flutterwave signature scheme:
 *  - `verif-hash`: the dashboard's secret hash, sent as-is (v3 webhooks);
 *  - `flutterwave-signature`: base64 HMAC-SHA256 of the raw body keyed with that secret hash.
 */
export function verifyFlutterwaveSignature(rawBody: string, headers: { verifHash: string | null; signature: string | null }, secret: string): boolean {
  if (!secret) return false;
  if (headers.signature) {
    const expected = createHmac("sha256", secret).update(rawBody).digest();
    return same(expected, Buffer.from(headers.signature, "base64"));
  }
  if (headers.verifHash) return same(Buffer.from(secret), Buffer.from(headers.verifHash));
  return false;
}

export function signFlutterwavePayload(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

function mapStatus(status: unknown): StatusResult["state"] {
  const s = String(status ?? "").toLowerCase();
  if (s === "successful") return "success";
  if (s === "failed" || s === "cancelled") return "failed";
  return "pending";
}

async function call<T>(path: string, init: RequestInit = {}): Promise<{ http: number; body: T }> {
  let res: Response;
  try {
    res = await fetch(API + path, {
      ...init,
      headers: { Authorization: `Bearer ${env().FLW_SECRET_KEY}`, "Content-Type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new PaymentError(`Could not reach Flutterwave: ${(e as Error).message}`);
  }
  const text = await res.text();
  try {
    return { http: res.status, body: JSON.parse(text) as T };
  } catch {
    throw new PaymentError(`Flutterwave returned HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

interface FlwTransaction { id?: number | string; tx_ref?: string; flw_ref?: string; status?: string; amount?: number | string; currency?: string; processor_response?: string }

function parseCharge(data: FlwTransaction): CallbackResult | null {
  if (!data || typeof data.tx_ref !== "string") return null;
  const state = mapStatus(data.status);
  return {
    providerRef: data.tx_ref,
    success: state === "success",
    code: String(data.status ?? ""),
    description: data.processor_response ?? String(data.status ?? ""),
    amount: data.amount === undefined ? undefined : Number(data.amount),
    currency: data.currency,
    receipt: data.id === undefined ? undefined : String(data.id),
  };
}

export const flutterwave: PaymentProvider = {
  name: "flutterwave",

  async startPayment(input: StartPaymentInput) {
    const { body } = await call<{ status?: string; message?: string; data?: { link?: string } }>("/payments", {
      method: "POST",
      body: JSON.stringify({
        tx_ref: input.reference,
        amount: input.amount,
        currency: input.currency,
        redirect_url: input.returnUrl,
        payment_options: input.paymentOptions,
        customer: { email: input.email, name: input.name, ...(input.phone ? { phonenumber: input.phone } : {}) },
        customizations: { title: env().APP_NAME, description: input.description, logo: `${env().PUBLIC_URL.replace(/\/$/, "")}/icon.svg` },
        meta: { country: input.country },
      }),
    });
    if (body.status !== "success" || !body.data?.link) throw new PaymentError(body.message ?? "Flutterwave rejected the request.");
    return { providerRef: input.reference, customerMessage: "", redirectUrl: body.data.link };
  },

  async queryStatus(providerRef: string): Promise<StatusResult> {
    const { http, body } = await call<{ status?: string; message?: string; data?: FlwTransaction }>(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(providerRef)}`);
    if (body.status !== "success" || !body.data) {
      // Nothing yet: the customer hasn't completed (or abandoned) the hosted checkout.
      if (http === 404 || http === 400 || /no transaction/i.test(body.message ?? "")) return { state: "pending", code: "not_found", description: body.message ?? "Not found" };
      throw new PaymentError(body.message ?? `Flutterwave status query failed (HTTP ${http})`);
    }
    const cb = parseCharge(body.data);
    if (!cb || cb.providerRef !== providerRef) throw new PaymentError("Flutterwave returned a different transaction");
    return { state: mapStatus(body.data.status), code: cb.code, description: cb.description, receipt: cb.receipt, amount: cb.amount, currency: cb.currency };
  },

  /** Webhook body: `{ event: "charge.completed", data: { id, tx_ref, status, amount, currency, ... } }`. */
  parseCallback(payload: unknown): CallbackResult | null {
    const ev = payload as { event?: string; type?: string; data?: FlwTransaction };
    if ((ev?.event ?? ev?.type) !== "charge.completed" || !ev.data) return null;
    return parseCharge(ev.data);
  },
};

/**
 * Local development: the "hosted checkout" is just our own return URL, and the
 * status query reports the exact amount we asked for as paid. No money moves.
 */
export const mockFlutterwave: PaymentProvider = {
  name: "flutterwave",
  async startPayment(input) {
    return { providerRef: input.reference, customerMessage: "Test mode", redirectUrl: input.returnUrl };
  },
  async queryStatus(ref) {
    const id = ref.replace(/^pf_/, "");
    const [p] = /^[0-9a-f-]{36}$/i.test(id) ? await db.select().from(schema.payments).where(eq(schema.payments.id, id)).limit(1) : [];
    if (!p) return { state: "pending", code: "not_found", description: "Not found (test mode)" };
    return {
      state: "success", code: "successful", description: "Approved (test mode)",
      receipt: `MOCK${id.replace(/-/g, "").slice(-8).toUpperCase()}`,
      amount: p.amount / 10 ** currencyExponent(p.currency), currency: p.currency,
    };
  },
  parseCallback: flutterwave.parseCallback,
};

export function flutterwaveProvider(): PaymentProvider {
  return env().FLW_ENV === "mock" ? mockFlutterwave : flutterwave;
}
