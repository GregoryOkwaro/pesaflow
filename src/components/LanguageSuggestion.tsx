"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

/**
 * "PesaFlow is also available in हिन्दी. [बदलें] [×]" — shown to visitors who haven't
 * picked a language yet, in the *suggested* language. Either button saves a choice
 * (pf_locale cookie), so it never shows again.
 */
export function LanguageSuggestion({ suggested, current, message, switchLabel }: {
  suggested: string; current: string; message: string; switchLabel: string;
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const choose = async (locale: string) => {
    setHidden(true);
    await api("POST", "/api/locale", { locale }).catch(() => {});
    if (locale !== current) router.refresh();
  };
  return (
    <div className="lang-suggest" role="region" aria-label={message} lang={suggested}>
      <span>{message}</span>
      <button className="btn sm primary" onClick={() => choose(suggested)}>{switchLabel}</button>
      <button className="close" onClick={() => choose(current)} aria-label="×">×</button>
    </div>
  );
}
