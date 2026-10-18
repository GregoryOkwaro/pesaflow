import { requestCountry, requestLocale, setLocaleCookie } from "@/i18n/server";
import type { Locale } from "@/i18n/translate";
import { setSessionCookie } from "@/server/auth/session";
import { body, clientIp, handler, json } from "@/server/http";
import { enforce } from "@/server/rateLimit";
import { signup, userJson } from "@/server/services/users";
import { verifyTurnstile } from "@/server/turnstile";
import { signupInput } from "@/server/validation";

export const POST = handler(async (req) => {
  const ip = clientIp(req);
  await enforce(`signup:${ip}`, 5, 3600, "errors.rateSignup");
  const input = await body(req, signupInput);
  await verifyTurnstile(input.turnstileToken, ip);
  const { user, session } = await signup(input, { country: await requestCountry(), locale: await requestLocale() });
  await setSessionCookie(session.token, session.expires);
  await setLocaleCookie(user.locale as Locale);
  return json({ user: userJson(user) }, 201);
});
