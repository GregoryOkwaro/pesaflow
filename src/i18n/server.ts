/** Server-side locale resolution: user setting → pf_locale cookie → Accept-Language. */
import { cookies, headers } from "next/headers";
import { isLocale, negotiateLocale, translator, type Locale } from "./translate";

export const LOCALE_COOKIE = "pf_locale";

export async function requestLocale(userLocale?: string | null): Promise<Locale> {
  if (isLocale(userLocale)) return userLocale;
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  return negotiateLocale((await headers()).get("accept-language"), await requestCountry());
}

export async function getT(userLocale?: string | null) {
  return translator(await requestLocale(userLocale));
}

/**
 * Visitor's country: Cloudflare's CF-IPCountry header when proxied through Cloudflare,
 * else the region of their preferred browser language ("sw-KE" -> KE), else null.
 */
export async function requestCountry(): Promise<string | null> {
  const h = await headers();
  const c = h.get("cf-ipcountry");
  if (c && /^[A-Z]{2}$/.test(c) && c !== "XX" && c !== "T1") return c;
  const region = (h.get("accept-language") ?? "").match(/^[a-z]{2,3}-([A-Z]{2})\b/i)?.[1]?.toUpperCase();
  return region ?? null;
}

export async function setLocaleCookie(locale: Locale) {
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
}
