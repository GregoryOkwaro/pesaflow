/**
 * Server-side translations: all dictionaries, loaded once per process. Browser code
 * must import from "./core" instead, so it only receives the active dictionary.
 */
import { createTranslator, type Locale, type Translator } from "./core";
import type { Messages } from "./messages/en";
import { am } from "./messages/am";
import { ar } from "./messages/ar";
import { bn } from "./messages/bn";
import { de } from "./messages/de";
import { en } from "./messages/en";
import { es } from "./messages/es";
import { fr } from "./messages/fr";
import { ha } from "./messages/ha";
import { hi } from "./messages/hi";
import { id } from "./messages/id";
import { it } from "./messages/it";
import { ja } from "./messages/ja";
import { ko } from "./messages/ko";
import { nl } from "./messages/nl";
import { pl } from "./messages/pl";
import { pt } from "./messages/pt";
import { ru } from "./messages/ru";
import { sw } from "./messages/sw";
import { th } from "./messages/th";
import { tr } from "./messages/tr";
import { uk } from "./messages/uk";
import { ur } from "./messages/ur";
import { vi } from "./messages/vi";
import { yo } from "./messages/yo";
import { zhHans } from "./messages/zh-Hans";
import { zhHant } from "./messages/zh-Hant";

export * from "./core";

export const DICTIONARIES: Record<Locale, Messages> = {
  en, ar, am, bn, de, es, fr, ha, hi, id, it, ja, ko, nl, pl, pt, ru, sw, th, tr, uk, ur, vi, yo,
  "zh-Hans": zhHans, "zh-Hant": zhHant,
};

const cache = new Map<Locale, Translator>();
export function translator(locale: Locale): Translator {
  let t = cache.get(locale);
  if (!t) cache.set(locale, (t = createTranslator(locale, DICTIONARIES[locale])));
  return t;
}
