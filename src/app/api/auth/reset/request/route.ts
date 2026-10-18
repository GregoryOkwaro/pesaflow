import { body, clientIp, handler, json } from "@/server/http";
import { enforce, hit } from "@/server/rateLimit";
import { getT } from "@/i18n/server";
import { requestReset, RESET_SENT_KEY } from "@/server/services/users";
import { verifyTurnstile } from "@/server/turnstile";
import { resetRequestInput } from "@/server/validation";

export const POST = handler(async (req) => {
  const ip = clientIp(req);
  const { email, turnstileToken } = await body(req, resetRequestInput);
  await enforce(`reset:ip:${ip}`, 10, 3600, "errors.rateReset");
  await verifyTurnstile(turnstileToken, ip);
  // Per-email limit answers exactly like success, so it can't be used to probe for accounts.
  if (process.env.RATE_LIMIT_DISABLED === "1" || (await hit(`reset:email:${email}`, 3, 3600))) await requestReset(email);
  return json({ ok: true, message: (await getT()).t(RESET_SENT_KEY) });
});
