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

/** Today's date in Kenya (UTC+3, no DST). */
export function todayInNairobi(now: Date = new Date()): ISODate {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

export function weekday(iso: ISODate): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

export function formatDate(iso: ISODate, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
}
