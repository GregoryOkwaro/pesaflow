import { eq } from "drizzle-orm";
import { z } from "zod";
import { setLocaleCookie } from "@/i18n/server";
import { isLocale, type Locale } from "@/i18n/translate";
import { currentUser } from "@/server/auth/session";
import { db, schema } from "@/server/db";
import { body, handler, json } from "@/server/http";

const input = z.object({ locale: z.string().refine(isLocale, "errors.localeInvalid") });

/** Language switcher (works signed in or out). Signed-in users also get it saved to their profile. */
export const POST = handler(async (req) => {
  const locale = (await body(req, input)).locale as Locale;
  await setLocaleCookie(locale);
  const user = await currentUser();
  if (user) await db.update(schema.users).set({ locale }).where(eq(schema.users.id, user.id));
  return json({ ok: true });
});
