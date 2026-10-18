import type { Metadata, Viewport } from "next";
import { I18nProvider } from "@/i18n/client";
import { getT, requestLocale } from "@/i18n/server";
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
  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
