/**
 * Exchange rates for *display only*: "USD 3 ≈ ₹250". Nothing is ever charged or
 * stored using these rates. Prices actually charged come from M-Pesa (KES) or
 * Paddle (its own local price, including tax). Source: open.er-api.com (free,
 * daily, no key; attribution "Rates by Exchange Rate API" required).
 */
import { sql } from "drizzle-orm";
import { currencyExponent } from "@/lib/money";
import { db, schema } from "../db";

const SOURCE = "https://open.er-api.com/v6/latest/USD";
const STALE_MS = 26 * 3_600_000;

export type Rates = Record<string, number>;

let cache: { rates: Rates; loadedAt: number; newest: number } | undefined;
let refreshing: Promise<number> | undefined;
let lastAttempt = 0;

/** Fetches today's rates and stores them. Returns how many currencies were updated. */
export async function refreshRates(fetchImpl: typeof fetch = fetch): Promise<number> {
  const res = await fetchImpl(SOURCE, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`FX source HTTP ${res.status}`);
  const data = (await res.json()) as { result?: string; rates?: Record<string, number> };
  if (data.result !== "success" || !data.rates) throw new Error("FX source returned no rates");
  const rows = Object.entries(data.rates)
    .filter(([code, rate]) => /^[A-Z]{3}$/.test(code) && Number.isFinite(rate) && rate > 0)
    .map(([currency, perUsd]) => ({ currency, perUsd, updatedAt: new Date() }));
  if (!rows.length) return 0;
  await db.insert(schema.fxRates).values(rows).onConflictDoUpdate({
    target: schema.fxRates.currency,
    set: { perUsd: sql`excluded.per_usd`, updatedAt: sql`excluded.updated_at` },
  });
  cache = undefined;
  return rows.length;
}

/** Current rates (cached for an hour). Triggers a background refresh when missing or stale. */
export async function getRates(): Promise<Rates> {
  if (cache && Date.now() - cache.loadedAt < 3_600_000) return cache.rates;
  const rows = await db.select().from(schema.fxRates);
  const rates = Object.fromEntries(rows.map((r) => [r.currency, r.perUsd]));
  const newest = rows.reduce((m, r) => Math.max(m, r.updatedAt.getTime()), 0);
  cache = { rates, loadedAt: Date.now(), newest };
  if ((!rows.length || Date.now() - newest > STALE_MS) && Date.now() - lastAttempt > 3_600_000 && process.env.FX_AUTO_REFRESH !== "0") {
    lastAttempt = Date.now();
    refreshing ??= refreshRates().catch((e) => { console.warn("[fx] refresh failed:", (e as Error).message); return 0; })
      .finally(() => { refreshing = undefined; });
  }
  return rates;
}

/**
 * USD minor units -> a rounded "about this much" in `currency` minor units, or null if unknown.
 * Rounded to 2 significant figures so it reads as an estimate (₹249.37 -> ₹250).
 */
export function approxFromUsd(usdMinor: number, currency: string, rates: Rates): number | null {
  if (currency === "USD") return usdMinor;
  const rate = rates[currency];
  if (!rate) return null;
  const major = (usdMinor / 100) * rate;
  if (major <= 0) return 0;
  const exp = currencyExponent(currency);
  // Two significant figures, but never finer than the currency's smallest unit.
  const magnitude = Math.max(10 ** -exp, 10 ** (Math.floor(Math.log10(major)) - 1));
  const rounded = Math.round(major / magnitude) * magnitude;
  return Math.round(rounded * 10 ** exp);
}
