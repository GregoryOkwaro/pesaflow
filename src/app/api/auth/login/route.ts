import { setLocaleCookie } from "@/i18n/server";
import { isLocale } from "@/i18n/translate";
import { setSessionCookie } from "@/server/auth/session";
import { body, clientIp, handler, json } from "@/server/http";
import { enforce } from "@/server/rateLimit";
import { login, userJson } from "@/server/services/users";
import { loginInput } from "@/server/validation";

export const POST = handler(async (req) => {
  const { email, password } = await body(req, loginInput);
  const msg = "errors.rateLogin" as const;
  await enforce(`login:ip:${clientIp(req)}`, 20, 900, msg);
  await enforce(`login:email:${email}`, 10, 900, msg);
  const { user, session } = await login(email, password);
  await setSessionCookie(session.token, session.expires);
  if (isLocale(user.locale)) await setLocaleCookie(user.locale);
  return json({ user: userJson(user) });
});
