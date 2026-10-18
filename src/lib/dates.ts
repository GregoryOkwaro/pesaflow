/**
 * Calendar dates as ISO "YYYY-MM-DD" strings, with arithmetic done on whole
 * UTC day numbers so time zones and DST can never move a date.
 */
export type ISODate = string;

const MS_PER_DAY = 86_400_000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== "string" || !ISO_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

export function toDayNumber(iso: ISODate): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / MS_PER_DAY);
}

export function fromDayNumber(n: number): ISODate {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(iso: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(iso) + days);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return toDayNumber(a) - toDayNumber(b);
}

/** Today's calendar date in an IANA time zone (handles DST). Falls back to UTC for unknown zones. */
export function todayIn(timeZone: string, now: Date = new Date()): ISODate {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Kept for Kenya-specific code paths (Daraja timestamps). */
export function todayInNairobi(now: Date = new Date()): ISODate {
  return todayIn("Africa/Nairobi", now);
}

export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function weekday(iso: ISODate): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** Formats a calendar date in the given UI locale ("en" renders day-first, as in Kenya and the UK). */
export function formatDate(iso: ISODate, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }, locale = "en"): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale === "en" ? "en-GB" : locale, { ...opts, timeZone: "UTC" });
}
