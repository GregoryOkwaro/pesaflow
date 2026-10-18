import { setSessionCookie } from "@/server/auth/session";
import { body, clientIp, handler, json } from "@/server/http";
import { enforce } from "@/server/rateLimit";
import { signup, userJson } from "@/server/services/users";
import { verifyTurnstile } from "@/server/turnstile";
import { signupInput } from "@/server/validation";

export const POST = handler(async (req) => {
  const ip = clientIp(req);
  await enforce(`signup:${ip}`, 5, 3600, "Too many sign-ups from this network. Try again later.");
  const input = await body(req, signupInput);
  await verifyTurnstile(input.turnstileToken, ip);
  const { user, session } = await signup(input);
  await setSessionCookie(session.token, session.expires);
  return json({ user: userJson(user) }, 201);
});
