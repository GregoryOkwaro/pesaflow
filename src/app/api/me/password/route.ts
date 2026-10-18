import { requireUser, setSessionCookie } from "@/server/auth/session";
import { body, handler, json } from "@/server/http";
import { changePassword } from "@/server/services/users";
import { changePasswordInput } from "@/server/validation";

export const POST = handler(async (req) => {
  const user = await requireUser();
  const { current, next } = await body(req, changePasswordInput);
  const session = await changePassword(user, current, next);
  await setSessionCookie(session.token, session.expires);
  return json({ ok: true });
});
