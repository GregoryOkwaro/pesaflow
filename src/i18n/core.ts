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

/**
 * Main supported language(s) per country, most widely read first. Used only as a
 * fallback and to *suggest* a language: what the person set on their device wins.
 * Countries whose everyday web language is English (KE, NG, IN...) list English
 * first for that reason, with the local language offered as a suggestion.
 */
const COUNTRY_LANGUAGES: Record<string, Locale[]> = {
  KE: ["en", "sw"], TZ: ["sw", "en"], UG: ["en", "sw"], RW: ["en", "fr", "sw"], ET: ["am", "en"],
  NG: ["en", "ha", "yo"], GH: ["en"], NE: ["fr", "ha"], ZA: ["en"],
  IN: ["en", "hi"], PK: ["ur", "en"], BD: ["bn", "en"],
  CN: ["zh-Hans"], SG: ["en", "zh-Hans"], TW: ["zh-Hant"], HK: ["zh-Hant", "en"], MO: ["zh-Hant", "pt"],
  JP: ["ja"], KR: ["ko"], ID: ["id"], VN: ["vi"], TH: ["th"], TR: ["tr"], UA: ["uk"], PL: ["pl"],
  IT: ["it"], SM: ["it"], NL: ["nl"], BE: ["nl", "fr"], SR: ["nl"],
  DE: ["de"], AT: ["de"], CH: ["de", "fr", "it"], LI: ["de"], LU: ["fr", "de"],
  FR: ["fr"], MC: ["fr"], CA: ["en", "fr"], HT: ["fr"],
  SN: ["fr"], CI: ["fr"], CM: ["fr", "en"], ML: ["fr"], BF: ["fr"], BJ: ["fr"], TG: ["fr"], GN: ["fr"],
  CD: ["fr"], CG: ["fr"], GA: ["fr"], MG: ["fr"], BI: ["fr"], DJ: ["fr", "ar"], TN: ["ar", "fr"], DZ: ["ar", "fr"], MA: ["ar", "fr"],
  ES: ["es"], MX: ["es"], AR: ["es"], CO: ["es"], CL: ["es"], PE: ["es"], VE: ["es"], EC: ["es"], BO: ["es"], PY: ["es"],
  UY: ["es"], GT: ["es"], HN: ["es"], SV: ["es"], NI: ["es"], CR: ["es"], PA: ["es"], DO: ["es"], PR: ["es", "en"], GQ: ["es"],
  PT: ["pt"], BR: ["pt"], AO: ["pt"], MZ: ["pt"], CV: ["pt"], GW: ["pt"], ST: ["pt"], TL: ["pt"],
  EG: ["ar"], SA: ["ar"], AE: ["ar", "en"], QA: ["ar", "en"], KW: ["ar"], BH: ["ar"], OM: ["ar"], JO: ["ar"], LB: ["ar", "fr"],
  IQ: ["ar"], YE: ["ar"], LY: ["ar"], SD: ["ar"], MR: ["ar", "fr"], PS: ["ar"], SO: ["ar"], KM: ["fr", "ar"], TD: ["fr", "ar"],
};

/** The country's main language when it differs from English, e.g. IN -> hi, KE -> sw, BR -> pt. */
export function countryLanguages(country: string | null | undefined): Locale[] {
  return (country && COUNTRY_LANGUAGES[country.toUpperCase()]) || ["en"];
}

/** A language worth offering this visitor ("PesaFlow is also available in हिन्दी"), or null. */
export function suggestedLocale(current: Locale, country: string | null | undefined): Locale | null {
  return countryLanguages(country).find((l) => l !== current && l !== "en") ?? null;
}

/**
 * Picks the best supported language from an Accept-Language header ("fr-CA,fr;q=0.9,en;q=0.8").
 * If none of the browser's languages is supported (e.g. Catalan in Spain), falls back to the
 * country's main language rather than straight to English.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined, country?: string | null): Locale {
  const fromBrowser = negotiateFromHeader(acceptLanguage);
  if (fromBrowser) return fromBrowser;
  return countryLanguages(country)[0] ?? DEFAULT_LOCALE;
}

function negotiateFromHeader(acceptLanguage: string | null | undefined): Locale | null {
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
  return null;
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
