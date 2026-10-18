import { setLocaleCookie } from "@/i18n/server";
import { isLocale } from "@/i18n/translate";
import { clearSessionCookie, requireUser } from "@/server/auth/session";
import { env, paymentConfig, planList } from "@/server/env";
import { body, handler, json } from "@/server/http";
import { pricingFor } from "@/server/pricing";
import { deleteAccount, updateProfile, userJson } from "@/server/services/users";
import { deleteAccountInput, profileInput } from "@/server/validation";

export const GET = handler(async () => {
  const user = await requireUser();
  return json({ user: userJson(user), plans: planList(), payments: paymentConfig(), pricing: await pricingFor(user.country), appName: env().APP_NAME });
});

export const PUT = handler(async (req) => {
  const user = await requireUser();
  const updated = await updateProfile(user, await body(req, profileInput));
  if (isLocale(updated.locale)) await setLocaleCookie(updated.locale);
  return json({ user: userJson(updated) });
});

/** GDPR erasure: requires the password, cancels any card subscription, deletes everything. */
export const DELETE = handler(async (req) => {
  const user = await requireUser();
  const { password } = await body(req, deleteAccountInput);
  await deleteAccount(user, password);
  await clearSessionCookie();
  return json({ ok: true });
});
