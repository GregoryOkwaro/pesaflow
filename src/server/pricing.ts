/**
 * What a visitor from a given country sees when choosing a plan:
 *  - Kenya: exact KES prices for M-Pesa; card prices in USD with ≈ KES.
 *  - Elsewhere: USD list price plus ≈ local currency (today's rate). With Paddle live, the
 *    browser replaces these with Paddle's exact local price incl. tax (PricePreview).
 */
import { currencyForCountry, isCountry } from "@/lib/countries";
import { paymentConfig, planList } from "./env";
import { PADDLE_CURRENCIES, paymentMethodsFor } from "./payments/methods";
import { approxFromUsd, getRates } from "./services/fx";

export async function pricingFor(rawCountry: string | null | undefined) {
  const country = isCountry(rawCountry) ? rawCountry : "US";
  const localCurrency = currencyForCountry(country);
  const config = paymentConfig();
  const rates = localCurrency === "USD" ? {} : await getRates().catch(() => ({}));
  return {
    country,
    localCurrency,
    // Paddle can charge this currency directly (with country price overrides set in Paddle).
    chargedInLocal: PADDLE_CURRENCIES.has(localCurrency),
    methods: paymentMethodsFor(country, { cardEnabled: config.cardEnabled }),
    plans: planList().map((p) => ({
      ...p,
      approxLocal: localCurrency === "USD" ? null : approxFromUsd(p.usd, localCurrency, rates),
    })),
  };
}

export type Pricing = Awaited<ReturnType<typeof pricingFor>>;
