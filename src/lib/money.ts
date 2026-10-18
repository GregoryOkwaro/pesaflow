/**
 * Money is stored as integer *minor units* of an ISO 4217 currency: cents for
 * KES/USD/EUR (2 decimals), whole units for JPY/UGX (0), fils for KWD/BHD (3).
 * Never floats. Formatting is locale-aware via Intl.
 */
export type Minor = number;

const exponentCache = new Map<string, number>();

/** Decimal places used by a currency (from the platform's ISO 4217 data). */
export function currencyExponent(currency: string): number {
  let e = exponentCache.get(currency);
  if (e === undefined) {
    e = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    exponentCache.set(currency, e);
  }
  return e;
}

export function isCurrency(code: unknown): code is string {
  if (typeof code !== "string" || !/^[A-Z]{3}$/.test(code)) return false;
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("currency").includes(code) ?? true;
  } catch {
    return false;
  }
}

/** "1,250.50" / 1250.5 / "-300" -> minor units, or null if it isn't a valid amount for this currency. */
export function parseMoney(input: unknown, currency: string): Minor | null {
  if (input === null || input === undefined || input === "") return 0;
  const s = String(input).replace(/[,\s  ']/g, "");
  const exp = currencyExponent(currency);
  const re = exp > 0 ? new RegExp(`^-?\\d+(\\.\\d{1,${exp}})?$`) : /^-?\d+$/;
  if (!re.test(s)) return null;
  const negative = s.startsWith("-");
  const [whole = "0", frac = ""] = s.replace("-", "").split(".");
  const minor = Number(whole) * 10 ** exp + Number((frac + "000").slice(0, exp) || 0);
  if (!Number.isSafeInteger(minor) || Math.abs(minor) > 1e15) return null;
  return negative ? -minor : minor;
}

/** Minor units -> plain decimal string for inputs and CSV ("1250.5", "-300", "1500" for JPY). */
export function toDecimalString(minor: Minor, currency: string): string {
  const exp = currencyExponent(currency);
  if (exp === 0) return String(minor);
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 10 ** exp);
  const frac = String(abs % 10 ** exp).padStart(exp, "0").replace(/0+$/, "");
  return `${minor < 0 ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

const fmtCache = new Map<string, Intl.NumberFormat>();
function fmt(locale: string, currency: string, style: "currency" | "decimal", sign: boolean) {
  const key = `${locale}|${currency}|${style}|${sign}`;
  let f = fmtCache.get(key);
  if (!f) {
    const exp = currencyExponent(currency);
    f = new Intl.NumberFormat(locale, {
      style, currency: style === "currency" ? currency : undefined,
      currencyDisplay: "code", minimumFractionDigits: 0, maximumFractionDigits: exp,
      signDisplay: sign ? "exceptZero" : "auto",
    });
    fmtCache.set(key, f);
  }
  return f;
}

/** e.g. "KES 1,250.50", "USD -12", "1.250,50 EUR" (de), with "+" when sign is requested. */
export function formatMoney(minor: Minor, currency: string, locale = "en", opts: { sign?: boolean } = {}): string {
  return fmt(locale, currency, "currency", !!opts.sign).format(minor / 10 ** currencyExponent(currency));
}

/** Number only, no currency code (dense tables). */
export function formatAmount(minor: Minor, currency: string, locale = "en"): string {
  return fmt(locale, currency, "decimal", false).format(minor / 10 ** currencyExponent(currency));
}
