import { env } from "@/server/env";
import { json } from "@/server/http";
import { verifyPaddleSignature, type PaddleEvent } from "@/server/payments/paddle";
import { handlePaddleEvent } from "@/server/services/billing";

/**
 * Paddle notification destination. Server-to-server: no CSRF header; authenticated
 * by the HMAC signature over the raw body. Returns 5xx on our own failures so
 * Paddle retries (handlers are idempotent).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = env().PADDLE_WEBHOOK_SECRET ?? "";
  if (!verifyPaddleSignature(raw, req.headers.get("paddle-signature"), secret)) {
    return json({ error: "invalid signature" }, 401);
  }
  let event: PaddleEvent;
  try {
    event = JSON.parse(raw) as PaddleEvent;
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  try {
    await handlePaddleEvent(event);
  } catch (e) {
    console.error("[paddle webhook]", event.event_type, e);
    return json({ error: "temporary failure" }, 500);
  }
  return json({ ok: true });
}
