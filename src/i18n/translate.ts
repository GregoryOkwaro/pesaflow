/** Pure translation helpers shared by server and browser. */
import { de } from "./messages/de";
import { en, type Messages } from "./messages/en";
import { es } from "./messages/es";
import { fr } from "./messages/fr";
import { pt } from "./messages/pt";
import { sw } from "./messages/sw";

export const LOCALES = ["en", "sw", "fr", "es", "pt", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
/** Shown in each language's own name, so people can always find theirs. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English", sw: "Kiswahili", fr: "Français", es: "Español", pt: "Português", de: "Deutsch",
};

export const DICTIONARIES: Record<Locale, Messages> = { en, sw, fr, es, pt, de };

export const isLocale = (l: unknown): l is Locale => typeof l === "string" && (LOCALES as readonly string[]).includes(l);

/** Picks the best supported language from an Accept-Language header ("fr-CA,fr;q=0.9,en;q=0.8"). */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  const prefs = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag = "", q = "q=1"] = part.trim().split(";");
      return { lang: tag.toLowerCase().split("-")[0]!, q: Number(q.replace("q=", "")) || 0 };
    })
    .filter((p) => p.lang)
    .sort((a, b) => b.q - a.q);
  return (prefs.find((p) => isLocale(p.lang))?.lang as Locale) ?? DEFAULT_LOCALE;
}

// Dot-paths to string leaves ("errors.generic") and to plural groups ("sub.trialBadge").
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : T[K] extends { one: string; other: string } ? never : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
type Plurals<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? never : T[K] extends { one: string; other: string } ? `${P}${K}` : Plurals<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Messages>;
export type PluralKey = Plurals<Messages>;
export type Vars = Record<string, string | number>;

function lookup(dict: Messages, path: string): unknown {
  return path.split(".").reduce<unknown>((node, k) => (node && typeof node === "object" ? (node as Record<string, unknown>)[k] : undefined), dict);
}

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

export interface Translator {
  locale: Locale;
  t: (key: MessageKey, vars?: Vars) => string;
  /** Plural-aware: picks `.one` or `.other` using the language's plural rules; {count} is filled in. */
  tp: (key: PluralKey, count: number, vars?: Vars) => string;
  /** Translates when `key` is a known message key ("errors.x"), else returns it unchanged. */
  tMaybe: (key: string, vars?: Vars) => string;
}

export function translator(locale: Locale): Translator {
  const dict = DICTIONARIES[locale];
  const rules = new Intl.PluralRules(locale);
  const get = (key: string): string | undefined => {
    const v = lookup(dict, key) ?? lookup(en, key);
    return typeof v === "string" ? v : undefined;
  };
  return {
    locale,
    t: (key, vars) => fill(get(key) ?? key, vars),
    tp: (key, count, vars) => {
      const group = (lookup(dict, key) ?? lookup(en, key)) as { one: string; other: string } | undefined;
      const form = rules.select(count) === "one" ? "one" : "other";
      return fill(group?.[form] ?? key, { count, ...vars });
    },
    tMaybe: (key, vars) => fill(get(key) ?? key, vars),
  };
}
