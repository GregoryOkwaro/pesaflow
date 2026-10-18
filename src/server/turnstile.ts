/** Cloudflare Turnstile verification (bot check on sign-up and password reset). Skipped when not configured. */
import { env } from "./env";
import { ApiError } from "./http";

export async function verifyTurnstile(token: string | undefined, ip: string): Promise<void> {
  const secret = env().TURNSTILE_SECRET_KEY;
  if (!secret) return;
  if (!token) throw new ApiError(400, "errors.captchaRequired");
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const data = (await res?.json().catch(() => null)) as { success?: boolean } | null;
  if (!data?.success) throw new ApiError(400, "errors.captchaFailed");
}
