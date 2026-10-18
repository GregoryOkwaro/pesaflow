/**
 * Locale list and the pure translation engine. No dictionaries are imported here,
 * so the browser bundle only ever carries the one language the server hands it.
 */
import type { Messages, PluralForms } from "./messages/en";

/** BCP 47 tags. Chinese is split by script: Simplified (mainland, Singapore) and Traditional (Taiwan, Hong Kong, Macau). */
export const LOCALES = [
  "en", "ar", "am", "bn", "de", "es", "fr", "ha", "hi", "id", "it", "ja", "ko", "nl",
  "pl", "pt", "ru", "sw", "th", "tr", "uk", "ur", "vi", "yo", "zh-Hans", "zh-Hant",
] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Each language in its own name, so people can always find theirs. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English", ar: "العربية", am: "አማርኛ", bn: "বাংলা", de: "Deutsch", es: "Español", fr: "Français",
  ha: "Hausa", hi: "हिन्दी", id: "Bahasa Indonesia", it: "Italiano", ja: "日本語", ko: "한국어", nl: "Nederlands",
  pl: "Polski", pt: "Português", ru: "Русский", sw: "Kiswahili", th: "ไทย", tr: "Türkçe", uk: "Українська",
  ur: "اردو", vi: "Tiếng Việt", yo: "Yorùbá", "zh-Hans": "简体中文", "zh-Hant": "繁體中文",
};

const RTL = new Set<Locale>(["ar", "ur"]);
export const isRtl = (l: string) => RTL.has(l as Locale);
export const dirOf = (l: string): "rtl" | "ltr" => (isRtl(l) ? "rtl" : "ltr");

export const isLocale = (l: unknown): l is Locale => typeof l === "string" && (LOCALES as readonly string[]).includes(l);

/** Maps any BCP 47 tag to a supported locale ("zh-TW" -> zh-Hant, "pt-BR" -> pt, "fil" -> null). */
export function matchLocale(tag: string): Locale | null {
  const t = tag.trim().toLowerCase();
  if (!t) return null;
  if (t.startsWith("zh")) return /hant|-tw|-hk|-mo/.test(t) ? "zh-Hant" : "zh-Hans";
  const primary = t.split("-")[0]!;
  return isLocale(primary) ? primary : null;
}

/** Picks the best supported language from an Accept-Language header ("fr-CA,fr;q=0.9,en;q=0.8"). */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  const prefs = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag = "", q = "q=1"] = part.trim().split(";");
      return { tag, q: Number(q.replace("q=", "")) || 0 };
    })
    .filter((p) => p.tag)
    .sort((a, b) => b.q - a.q);
  for (const p of prefs) {
    const m = matchLocale(p.tag);
    if (m) return m;
  }
  return DEFAULT_LOCALE;
}

// Dot-paths to string leaves ("errors.generic") and to plural groups ("sub.trialBadge").
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : T[K] extends PluralForms ? never : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
type Plurals<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? never : T[K] extends PluralForms ? `${P}${K}` : Plurals<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Messages>;
export type PluralKey = Plurals<Messages>;
export type Vars = Record<string, string | number>;

function lookup(dict: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, k) => (node && typeof node === "object" ? (node as Record<string, unknown>)[k] : undefined), dict);
}

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

export interface Translator {
  locale: Locale;
  t: (key: MessageKey, vars?: Vars) => string;
  /** Plural-aware, using the language's own CLDR rules (Arabic has six forms, Russian four, Japanese one). */
  tp: (key: PluralKey, count: number, vars?: Vars) => string;
  /** Translates when `key` is a known message key ("errors.x"), else returns it unchanged. */
  tMaybe: (key: string, vars?: Vars) => string;
}

export function createTranslator(locale: Locale, dict: Messages): Translator {
  const rules = new Intl.PluralRules(locale);
  const get = (key: string) => {
    const v = lookup(dict, key);
    return typeof v === "string" ? v : undefined;
  };
  return {
    locale,
    t: (key, vars) => fill(get(key) ?? key, vars),
    tp: (key, count, vars) => {
      const group = lookup(dict, key) as PluralForms | undefined;
      const form = rules.select(count) as keyof PluralForms;
      return fill(group?.[form] ?? group?.other ?? key, { count, ...vars });
    },
    tMaybe: (key, vars) => fill(get(key) ?? key, vars),
  };
}
