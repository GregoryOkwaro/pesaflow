"use client";

import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { LOCALE_NAMES, LOCALES } from "@/i18n/core";
import { api } from "@/lib/api";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { t, locale } = useT();
  const router = useRouter();
  return (
    <select className={`lang-select ${className}`} aria-label={t("common.language")} value={locale}
      onChange={async (e) => { await api("POST", "/api/locale", { locale: e.target.value }).catch(() => {}); router.refresh(); }}>
      {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
    </select>
  );
}
