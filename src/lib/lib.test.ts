import { describe, expect, it } from "vitest";
import { COUNTRY_CODES, currencyForCountry } from "./countries";
import { isTimeZone, todayIn } from "./dates";
import { currencyExponent, formatMoney, isCurrency, parseMoney, toDecimalString } from "./money";
import { displayPhone, normalizeMpesaPhone, normalizePhone, phoneCountry } from "@/server/payments/phone";
import { negotiateLocale, translator } from "@/i18n/translate";

describe("money in any currency", () => {
  it("knows each currency's decimal places", () => {
    expect(currencyExponent("KES")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
  });
  it("parses amounts into minor units, rejecting too many decimals", () => {
    expect(parseMoney("1,250.50", "KES")).toBe(125050);
    expect(parseMoney("-300", "USD")).toBe(-30000);
    expect(parseMoney("1500", "JPY")).toBe(1500);
    expect(parseMoney("15.5", "JPY")).toBeNull();
    expect(parseMoney("1.234", "KWD")).toBe(1234);
    expect(parseMoney("1.234", "EUR")).toBeNull();
    expect(parseMoney("12abc", "EUR")).toBeNull();
  });
  it("round-trips decimal strings", () => {
    expect(toDecimalString(125050, "KES")).toBe("1250.5");
    expect(toDecimalString(-30000, "USD")).toBe("-300");
    expect(toDecimalString(1500, "JPY")).toBe("1500");
    expect(toDecimalString(5, "KWD")).toBe("0.005");
  });
  it("formats with the user's locale conventions", () => {
    expect(formatMoney(125050, "EUR", "de")).toMatch(/1\.250,5\s?EUR/);
    expect(formatMoney(125050, "KES", "en")).toMatch(/KES\s?1,250\.5/);
    expect(formatMoney(1500, "JPY", "en", { sign: true })).toMatch(/^\+JPY\s?1,500$/);
  });
  it("every country maps to a real currency", () => {
    expect(COUNTRY_CODES.length).toBeGreaterThanOrEqual(238);
    for (const c of ["IR", "KP", "CU", "SY", "RU"]) expect(COUNTRY_CODES).not.toContain(c);
    for (const c of COUNTRY_CODES) expect(isCurrency(currencyForCountry(c)), c).toBe(true);
  });
});

describe("time zones", () => {
  const instant = new Date("2026-10-18T22:30:00Z");
  it("computes 'today' in the user's own zone", () => {
    expect(todayIn("Africa/Nairobi", instant)).toBe("2026-10-19"); // 01:30 next day
    expect(todayIn("America/New_York", instant)).toBe("2026-10-18");
    expect(todayIn("Pacific/Auckland", instant)).toBe("2026-10-19");
    expect(todayIn("Not/AZone", instant)).toBe("2026-10-18"); // UTC fallback
  });
  it("validates IANA names", () => {
    expect(isTimeZone("Europe/Berlin")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
  });
});

describe("phone numbers worldwide", () => {
  it("normalizes local formats using the user's country", () => {
    expect(normalizePhone("0712 345 678", "KE")).toBe("254712345678");
    expect(normalizePhone("07400 123456", "GB")).toBe("447400123456");
    expect(normalizePhone("+33 6 12 34 56 78", "KE")).toBe("33612345678");
    expect(normalizePhone("123", "KE")).toBeNull();
  });
  it("M-Pesa only accepts Kenyan mobiles", () => {
    expect(normalizeMpesaPhone("+254 712 345 678")).toBe("254712345678");
    expect(normalizeMpesaPhone("+447700900123")).toBeNull();
  });
  it("detects country and formats for display", () => {
    expect(phoneCountry("447400123456")).toBe("GB");
    expect(displayPhone("254712345678", "KE")).toBe("0712 345678");
    expect(displayPhone("254712345678", "DE")).toBe("+254 712 345678");
  });
});

describe("language negotiation", () => {
  it("picks the best supported language", () => {
    expect(negotiateLocale("fr-CA,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(negotiateLocale("ja,de;q=0.5")).toBe("de");
    expect(negotiateLocale("zh-CN")).toBe("en");
    expect(negotiateLocale(null)).toBe("en");
  });
  it("uses each language's plural rules and fills placeholders", () => {
    expect(translator("en").tp("sub.trialBadge", 1)).toBe("Trial · 1 day left");
    expect(translator("en").tp("sub.trialBadge", 5)).toBe("Trial · 5 days left");
    expect(translator("fr").tp("sub.trialBadge", 0)).toBe("Essai · 0 jour restant"); // French: 0 is singular
    expect(translator("de").t("errors.maxBudgets", { max: 10 })).toBe("Sie können bis zu 10 Budgets haben.");
  });
});
