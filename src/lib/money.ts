/** Money is integer cents everywhere (bigint columns in Postgres, number in JS: safe to ±90 trillion KES). */
export type Cents = number;

const nf = new Intl.NumberFormat("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** "1,250.50" / 1250.5 / "-300" -> cents. Returns null for anything that isn't a plain number. */
export function parseKes(input: unknown): Cents | null {
  if (input === null || input === undefined || input === "") return 0;
  const s = String(input).replace(/[,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const negative = s.startsWith("-");
  const [whole = "0", frac = ""] = s.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > 1e13) return null;
  return negative ? -cents : cents;
}

export function formatKes(cents: Cents, opts: { sign?: boolean } = {}): string {
  const abs = nf.format(Math.abs(cents) / 100);
  const prefix = cents < 0 ? "−" : opts.sign && cents > 0 ? "+" : "";
  return `${prefix}KES ${abs}`;
}

export function formatPlain(cents: Cents): string {
  return nf.format(cents / 100);
}
