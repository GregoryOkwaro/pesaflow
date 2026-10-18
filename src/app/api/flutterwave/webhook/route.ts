import { env } from "@/server/env";
import { json } from "@/server/http";
import { verifyFlutterwaveSignature } from "@/server/payments/flutterwave";
import { handleFlutterwaveEvent } from "@/server/services/billing";

/**
 * Flutterwave webhook. Server-to-server: no CSRF header; authenticated by the
 * dashboard's secret hash (verif-hash) or its HMAC (flutterwave-signature).
 * Returns 5xx on our own failures so Flutterwave retries (handling is idempotent).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const ok = verifyFlutterwaveSignature(raw, {
    verifHash: req.headers.get("verif-hash"),
    signature: req.headers.get("flutterwave-signature"),
  }, env().FLW_WEBHOOK_HASH ?? "");
  if (!ok) return json({ error: "invalid signature" }, 401);
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  try {
    await handleFlutterwaveEvent(payload);
  } catch (e) {
    console.error("[flutterwave webhook]", e);
    return json({ error: "temporary failure" }, 500);
  }
  return json({ ok: true });
}
