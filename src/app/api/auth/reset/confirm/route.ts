import { setSessionCookie } from "@/server/auth/session";
import { body, clientIp, handler, json } from "@/server/http";
import { enforce } from "@/server/rateLimit";
import { confirmReset, userJson } from "@/server/services/users";
import { resetConfirmInput } from "@/server/validation";

export const POST = handler(async (req) => {
  await enforce(`reset-confirm:${clientIp(req)}`, 20, 900, "Too many attempts. Wait 15 minutes and try again.");
  const { email, code, newPassword } = await body(req, resetConfirmInput);
  const { user, session } = await confirmReset(email, code, newPassword);
  await setSessionCookie(session.token, session.expires);
  return json({ user: userJson(user) });
});
