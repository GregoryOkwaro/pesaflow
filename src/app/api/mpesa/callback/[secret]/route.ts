import { safeEqual } from "@/server/auth/crypto";
import { env } from "@/server/env";
import { handler, json } from "@/server/http";
import { handleCallback } from "@/server/services/billing";

/**
 * Daraja STK callback (server-to-server, so no CSRF header). Authenticated by
 * the secret in the URL; billing.handleCallback only settles a pending payment
 * we created, and checks the amount paid.
 */
export const POST = handler<{ params: Promise<{ secret: string }> }>(async (req, ctx) => {
  const { secret } = await ctx.params;
  const expected = env().MPESA_CALLBACK_SECRET;
  if (!expected || !safeEqual(secret, expected)) return json({ error: "Not found." }, 404);
  const payload = await req.json().catch(() => null);
  try {
    await handleCallback(payload);
  } catch (e) {
    // Let Daraja retry on our own failures (e.g. database briefly down).
    console.error("[mpesa callback]", e);
    return json({ ResultCode: 1, ResultDesc: "Temporary error" }, 500);
  }
  return json({ ResultCode: 0, ResultDesc: "Accepted" });
}, { csrf: false });
