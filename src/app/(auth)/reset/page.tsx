import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { getT, requestCountry } from "@/i18n/server";
import { env } from "@/server/env";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("auth.resetTitle") };
}

export default async function Page() {
  return <AuthForm mode="reset" turnstileSiteKey={env().TURNSTILE_SITE_KEY} countryHint={await requestCountry()} />;
}
