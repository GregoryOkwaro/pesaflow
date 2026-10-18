import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { LanguageSuggestion } from "@/components/LanguageSuggestion";
import { I18nProvider } from "@/i18n/client";
import { getT, LOCALE_COOKIE, requestCountry, requestLocale } from "@/i18n/server";
import { DICTIONARIES, dirOf, LOCALE_NAMES, suggestedLocale, translator } from "@/i18n/translate";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: { default: t("meta.title"), template: "%s · PesaFlow" },
    description: t("meta.description"),
    icons: { icon: "/icon.svg" },
    manifest: "/manifest.webmanifest",
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0f7b3f" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1411" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await requestLocale();
  // Offer the visitor's local language (by IP country) until they've made a choice.
  const chosen = (await cookies()).has(LOCALE_COOKIE);
  const suggested = chosen ? null : suggestedLocale(locale, await requestCountry());
  const st = suggested ? translator(suggested) : null;
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body>
        {suggested && st && (
          <div dir={dirOf(suggested)}>
            <LanguageSuggestion suggested={suggested} current={locale}
              message={st.t("common.availableIn", { language: LOCALE_NAMES[suggested] })} switchLabel={st.t("common.switchLanguage")} />
          </div>
        )}
        <I18nProvider locale={locale} messages={DICTIONARIES[locale]}>{children}</I18nProvider>
      </body>
    </html>
  );
}
