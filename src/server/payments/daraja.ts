/** Safaricom Daraja: Lipa Na M-Pesa Online (STK push), STK query and callback parsing. */
import { env } from "../env";
import { PaymentError, type CallbackResult, type PaymentProvider, type StartPaymentInput, type StatusResult } from "./types";

const HOSTS = { sandbox: "https://sandbox.safaricom.co.ke", production: "https://api.safaricom.co.ke" } as const;
// Daraja returns this while the customer hasn't finished entering their PIN.
const STILL_PROCESSING = "500.001.1001";

let token: { value: string; expires: number } | undefined;

function host() {
  const e = env().MPESA_ENV;
  if (e === "mock") throw new PaymentError("Daraja provider used in mock mode.");
  return HOSTS[e];
}

function timestamp(): string {
  // Daraja expects Nairobi local time: YYYYMMDDHHmmss
  return new Date(Date.now() + 3 * 3_600_000).toISOString().replace(/\D/g, "").slice(0, 14);
}

function password(ts: string): string {
  const e = env();
  return Buffer.from(`${e.MPESA_SHORTCODE}${e.MPESA_PASSKEY}${ts}`).toString("base64");
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(host() + path, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new PaymentError(`Could not reach M-Pesa: ${(e as Error).message}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new PaymentError(`M-Pesa returned HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function accessToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const e = env();
  const basic = Buffer.from(`${e.MPESA_CONSUMER_KEY}:${e.MPESA_CONSUMER_SECRET}`).toString("base64");
  const data = await call<{ access_token?: string; expires_in?: string }>("/oauth/v1/generate?grant_type=client_credentials", {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!data.access_token) throw new PaymentError("M-Pesa authentication failed. Check the consumer key and secret.");
  token = { value: data.access_token, expires: Date.now() + Number(data.expires_in ?? 3599) * 1000 };
  return token.value;
}

export function callbackUrl(): string {
  return `${env().PUBLIC_URL.replace(/\/$/, "")}/api/mpesa/callback/${env().MPESA_CALLBACK_SECRET}`;
}

export const daraja: PaymentProvider = {
  name: "mpesa",

  async startPayment(input: StartPaymentInput) {
    const e = env();
    const ts = timestamp();
    const data = await call<Record<string, string>>("/mpesa/stkpush/v1/processrequest", {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: e.MPESA_SHORTCODE,
        Password: password(ts),
        Timestamp: ts,
        TransactionType: e.MPESA_TRANSACTION_TYPE,
        Amount: input.amount,
        PartyA: input.phone,
        PartyB: e.MPESA_PARTY_B ?? e.MPESA_SHORTCODE,
        PhoneNumber: input.phone,
        CallBackURL: callbackUrl(),
        AccountReference: input.reference.slice(0, 12),
        TransactionDesc: input.description.slice(0, 13),
      }),
    });
    if (String(data.ResponseCode) !== "0" || !data.CheckoutRequestID) {
      throw new PaymentError(data.errorMessage ?? data.ResponseDescription ?? "M-Pesa rejected the request.");
    }
    return { providerRef: data.CheckoutRequestID, merchantRef: data.MerchantRequestID, customerMessage: data.CustomerMessage ?? "" };
  },

  async queryStatus(providerRef: string): Promise<StatusResult> {
    const e = env();
    const ts = timestamp();
    const data = await call<Record<string, string>>("/mpesa/stkpushquery/v1/query", {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ BusinessShortCode: e.MPESA_SHORTCODE, Password: password(ts), Timestamp: ts, CheckoutRequestID: providerRef }),
    });
    if (data.ResultCode === undefined || data.errorCode === STILL_PROCESSING) {
      return { state: "pending", code: data.errorCode ?? "", description: data.errorMessage ?? "Processing" };
    }
    const code = String(data.ResultCode);
    return { state: code === "0" ? "success" : "failed", code, description: data.ResultDesc ?? "" };
  },

  parseCallback(payload: unknown): CallbackResult | null {
    const cb = (payload as { Body?: { stkCallback?: Record<string, unknown> } })?.Body?.stkCallback;
    if (!cb || typeof cb.CheckoutRequestID !== "string") return null;
    const items = ((cb.CallbackMetadata as { Item?: { Name?: string; Value?: unknown }[] })?.Item ?? []);
    const meta = Object.fromEntries(items.filter((i) => i && i.Name).map((i) => [i.Name!, i.Value]));
    const code = String(cb.ResultCode);
    return {
      providerRef: cb.CheckoutRequestID,
      success: code === "0",
      code,
      description: String(cb.ResultDesc ?? ""),
      amount: meta.Amount === undefined ? undefined : Number(meta.Amount),
      receipt: meta.MpesaReceiptNumber ? String(meta.MpesaReceiptNumber) : undefined,
      phone: meta.PhoneNumber ? String(meta.PhoneNumber) : undefined,
    };
  },
};
