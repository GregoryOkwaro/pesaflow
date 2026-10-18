/**
 * How people in each country can pay, for display ("Ways to pay in India"). Paddle's
 * checkout always shows the live, definitive list; this mirrors Paddle's documented
 * coverage so customers know before they click. Brand names don't need translating.
 *
 * Paddle: cards everywhere; Apple Pay / Google Pay everywhere except India and Turkey;
 * PayPal where PayPal supports the currency; regional methods below (some must be
 * switched on in the Paddle dashboard: see README). Mobile money networks come first
 * where we collect them: M-Pesa in Kenya (Daraja), others via Flutterwave (mobileMoney.ts).
 */
import { mobileMoneyFor } from "./mobileMoney";

const REGIONAL: Record<string, string[]> = {
  IN: ["UPI"],
  BR: ["Pix"],
  CN: ["Alipay", "WeChat Pay"],
  NL: ["iDEAL"],
  BE: ["Bancontact"],
  PL: ["BLIK"],
  PT: ["MB WAY"],
  KR: ["KakaoPay", "Naver Pay"],
};
const NO_WALLETS = new Set(["IN", "TR"]); // Apple Pay / Google Pay unavailable via Paddle
const NO_PAYPAL = new Set(["IN"]); // PayPal doesn't support INR checkout through Paddle

export function paymentMethodsFor(country: string, opts: { cardEnabled: boolean }): string[] {
  const methods: string[] = [];
  if (country === "KE") methods.push("M-Pesa");
  methods.push(...(mobileMoneyFor(country)?.networks ?? []));
  if (!opts.cardEnabled) return methods;
  methods.push("Visa / Mastercard");
  methods.push(...(REGIONAL[country] ?? []));
  if (!NO_PAYPAL.has(country)) methods.push("PayPal");
  if (!NO_WALLETS.has(country)) methods.push("Apple Pay", "Google Pay");
  return methods;
}

/**
 * Currencies Paddle can charge in. The first 25 are confirmed from Paddle's supported-currencies
 * page; the last 8 complete Paddle's list of 33 but weren't visible there, so confirm them with
 * Paddle's GET /currencies before relying on them. Elsewhere customers pay by card in USD and
 * their bank converts, so we show "USD … ≈ local" as an estimate.
 */
export const PADDLE_CURRENCIES = new Set([
  "USD", "EUR", "GBP", "ARS", "AUD", "BRL", "CAD", "CHF", "CLP", "CNY", "COP", "CZK", "DKK", "HKD", "HUF",
  "ILS", "INR", "JPY", "KRW", "MXN", "NOK", "NZD", "PEN", "PLN", "SEK", "SGD", "THB", "TRY", "TWD", "UAH", "VND", "ZAR",
]);
