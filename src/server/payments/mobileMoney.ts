/**
 * Mobile money outside Kenya, collected through Flutterwave's hosted checkout.
 * Prepaid like M-Pesa: the customer approves one payment on their phone; no
 * automatic renewal. Prices are set per currency (not converted at today's rate),
 * so customers see round local amounts. Override them with FLW_PRICES.
 *
 * Coverage is per Flutterwave's mobile money docs; confirm each country is
 * enabled on your Flutterwave account before switching it on (FLW_COUNTRIES).
 */
import { currencyExponent } from "@/lib/money";
import { env, PLAN_KEYS, type PlanKey } from "../env";

export interface MobileMoneyCountry {
  currency: string;
  option: string; // Flutterwave Standard `payment_options` value
  networks: string[]; // brand names, shown as-is
  prices: [number, number, number]; // monthly, quarterly, yearly in major units (≈ USD 3 / 8 / 29)
}

export const MOBILE_MONEY: Record<string, MobileMoneyCountry> = {
  UG: { currency: "UGX", option: "mobilemoneyuganda", networks: ["MTN MoMo", "Airtel Money"], prices: [11_000, 29_000, 105_000] },
  RW: { currency: "RWF", option: "mobilemoneyrwanda", networks: ["MTN MoMo", "Airtel Money"], prices: [4_000, 11_000, 40_000] },
  TZ: { currency: "TZS", option: "mobilemoneytanzania", networks: ["Airtel Money", "Vodacom M-Pesa", "Mixx by Yas", "HaloPesa"], prices: [7_500, 20_000, 72_000] },
  ZM: { currency: "ZMW", option: "mobilemoneyzambia", networks: ["MTN MoMo", "Airtel Money"], prices: [75, 200, 720] },
  GH: { currency: "GHS", option: "mobilemoneyghana", networks: ["MTN MoMo", "Telecel Cash", "AirtelTigo Money"], prices: [40, 100, 360] },
  CM: { currency: "XAF", option: "mobilemoneyfranco", networks: ["MTN MoMo", "Orange Money"], prices: [1_800, 4_800, 17_500] },
  CI: { currency: "XOF", option: "mobilemoneyfranco", networks: ["MTN MoMo", "Orange Money", "Moov Money"], prices: [1_800, 4_800, 17_500] },
  SN: { currency: "XOF", option: "mobilemoneyfranco", networks: ["Orange Money"], prices: [1_800, 4_800, 17_500] },
};

function overrides(): Record<string, number[]> {
  const raw = env().FLW_PRICES;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) =>
      Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && n > 0)) as [string, number[]][]);
  } catch {
    console.warn("[mobile money] FLW_PRICES is not valid JSON; using default prices");
    return {};
  }
}

/** The mobile money offer for a country, or null where we don't collect mobile money. */
export function mobileMoneyFor(country: string) {
  const c = MOBILE_MONEY[country];
  if (!c) return null;
  const allow = env().FLW_COUNTRIES;
  if (allow && !allow.split(",").map((s) => s.trim().toUpperCase()).includes(country)) return null;
  const major = overrides()[c.currency] ?? c.prices;
  const scale = 10 ** currencyExponent(c.currency);
  const prices = Object.fromEntries(PLAN_KEYS.map((k, i) => [k, Math.round(major[i]! * scale)])) as Record<PlanKey, number>;
  return { country, currency: c.currency, option: c.option, networks: c.networks, prices }; // prices in minor units
}

export type MobileMoneyOffer = NonNullable<ReturnType<typeof mobileMoneyFor>>;
