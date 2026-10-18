/**
 * Translation integrity: the type system already forces every language to have
 * every key; this also checks at runtime that no string is empty, placeholders
 * match English exactly (a missing {amount} would silently drop information),
 * and nothing was left untranslated by accident.
 */
import { describe, expect, it } from "vitest";
import { DICTIONARIES, LOCALES } from "./translate";

type Tree = { [k: string]: string | Tree };
function flatten(t: Tree, prefix = ""): Record<string, string> {
  return Object.entries(t).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === "string" ? { ...acc, [key]: v } : { ...acc, ...flatten(v, key) };
  }, {});
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const en = flatten(DICTIONARIES.en as unknown as Tree);
// Strings that are legitimately the same in some languages (brand names, short labels).
const SAME_OK = new Set(["common.add", "landing.privacy", "daily.total", "daily.date", "seed.bank", "seed.mobileMoney",
  "nav.daily", "billing.days", "itemDialog.note", "settings.budgets", "budget.name", "status.pending", "items.from",
  "accountDialog.details", "overview.accounts", "common.continue", "common.cancel", "common.timezone", "daily.balance",
  "itemDialog.account", "common.currency", "common.country", "common.language", "auth.email", "daily.export", "billing.monthly",
  "settings.privacy", "overview.counted", "landing.terms", "items.until", "items.on", "auth.password", "seed.budget"]);

describe.each(LOCALES.filter((l) => l !== "en"))("%s translation", (locale) => {
  const dict = flatten(DICTIONARIES[locale] as unknown as Tree);
  it("has exactly the English keys", () => {
    expect(Object.keys(dict).sort()).toEqual(Object.keys(en).sort());
  });
  it("keeps every placeholder and has no empty strings", () => {
    for (const [key, value] of Object.entries(dict)) {
      expect(value.trim(), key).not.toBe("");
      // A singular form may say "the next day" instead of "the next {count} day".
      const expected = key.endsWith(".one") ? placeholders(en[key]!).filter((p) => p !== "count" || placeholders(value).includes("count")) : placeholders(en[key]!);
      expect(placeholders(value), key).toEqual(expected);
    }
  });
  it("is actually translated", () => {
    const untranslated = Object.keys(en).filter((k) => dict[k] === en[k] && en[k]!.length > 12 && !SAME_OK.has(k));
    expect(untranslated).toEqual([]);
  });
});
