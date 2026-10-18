import { requireUser } from "@/server/auth/session";
import { env, planList } from "@/server/env";
import { body, handler, json } from "@/server/http";
import { updateProfile, userJson } from "@/server/services/users";
import { profileInput } from "@/server/validation";

export const GET = handler(async () => {
  const user = await requireUser();
  return json({ user: userJson(user), plans: planList(), appName: env().APP_NAME, mpesaEnv: env().MPESA_ENV });
});

export const PUT = handler(async (req) => {
  const user = await requireUser();
  return json({ user: userJson(await updateProfile(user, await body(req, profileInput))) });
});
