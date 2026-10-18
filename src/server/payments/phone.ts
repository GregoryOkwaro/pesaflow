/**
 * Phone numbers are stored as E.164 digits without the "+" (e.g. 254712345678,
 * 447400123456). Parsing uses libphonenumber with the user's country as the
 * default region, so people can type numbers the way they do locally.
 */
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

export function normalizePhone(raw: string | null | undefined, defaultCountry = "KE"): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const p = parsePhoneNumberFromString(s, defaultCountry as CountryCode);
  if (!p?.isValid()) return null;
  const type = p.getType();
  if (type && !["MOBILE", "FIXED_LINE_OR_MOBILE"].includes(type)) return null;
  return p.number.replace(/^\+/, "");
}

/** M-Pesa (Daraja) only takes Kenyan mobile numbers: 2547XXXXXXXX or 2541XXXXXXXX. */
export function normalizeMpesaPhone(raw: string | null | undefined): string | null {
  const p = normalizePhone(raw, "KE");
  return p && /^254[17]\d{8}$/.test(p) ? p : null;
}

/** Back-compat name used by Kenya-only code paths. */
export const normalizeKenyanPhone = normalizeMpesaPhone;

export function phoneCountry(e164Digits: string | null | undefined): string | null {
  if (!e164Digits) return null;
  return parsePhoneNumberFromString("+" + e164Digits)?.country ?? null;
}

/** International display: "+254 712 345 678"; Kenyan numbers for Kenyan users in local form "0712 345 678". */
export function displayPhone(e164Digits: string | null | undefined, userCountry?: string): string {
  if (!e164Digits) return "";
  const p = parsePhoneNumberFromString("+" + e164Digits);
  if (!p) return "+" + e164Digits;
  return userCountry && p.country === userCountry ? p.formatNational() : p.formatInternational();
}
