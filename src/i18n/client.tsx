"use client";
/** Browser-side translations: the server passes the active locale; dictionaries are bundled. */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { translator, type Locale, type Translator } from "./translate";

const I18nContext = createContext<Translator>(translator("en"));

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => translator(locale), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useT = () => useContext(I18nContext);
