import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { getT, requestCountry } from "@/i18n/server";
import { env } from "@/server/env";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("common.logIn") };
}

export default async function Page() {
  return <AuthForm mode="login" turnstileSiteKey={env().TURNSTILE_SITE_KEY} countryHint={await requestCountry()} />;
}
