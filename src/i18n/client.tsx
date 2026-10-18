"use client";
/**
 * Browser-side translations. The server passes the active language's dictionary as a
 * prop, so the client bundle never includes the other 25 languages.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createTranslator, type Locale, type Translator } from "./core";
import type { Messages } from "./messages/en";

const I18nContext = createContext<Translator | null>(null);

export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: ReactNode }) {
  const value = useMemo(() => createTranslator(locale, messages), [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): Translator {
  const t = useContext(I18nContext);
  if (!t) throw new Error("useT() must be used inside <I18nProvider>");
  return t;
}
