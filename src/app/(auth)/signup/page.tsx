import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { getT, requestCountry, requestLocale } from "@/i18n/server";
import { countryOptions } from "@/lib/countries";
import { env } from "@/server/env";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("auth.createAccount") };
}

export default async function Page() {
  const countries = "signup" === "signup" ? countryOptions(await requestLocale()) : [];
  return <AuthForm mode="signup" turnstileSiteKey={env().TURNSTILE_SITE_KEY} countryHint={await requestCountry()} countries={countries} />;
}
