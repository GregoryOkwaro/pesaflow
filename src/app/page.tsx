import Link from "next/link";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { PaddlePrice } from "@/components/PaddlePrice";
import { getT, requestCountry } from "@/i18n/server";
import { formatMoney } from "@/lib/money";
import { env, paymentConfig } from "@/server/env";
import { pricingFor } from "@/server/pricing";

export const dynamic = "force-dynamic";

export default async function Landing() {
  const { t, locale } = await getT();
  const pricing = await pricingFor(await requestCountry());
  const config = paymentConfig();
  const kenya = pricing.country === "KE";
  const countryName = new Intl.DisplayNames([locale, "en"], { type: "region" }).of(pricing.country) ?? pricing.country;
  const showApprox = !kenya && pricing.plans.some((p) => p.approxLocal !== null);
  const features = [["f1Title", "f1Body"], ["f2Title", "f2Body"], ["f3Title", "f3Body"], ["f4Title", "f4Body"]] as const;
  const per = { monthly: "billing.perMonth", quarterly: "billing.perQuarter", yearly: "billing.perYear" } as const;
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4">
        <div className="brand"><img src="/icon.svg" alt="" /> PesaFlow</div>
        <div className="flex-1" />
        <LanguageSwitcher />
        <Link className="btn ghost" href="/login">{t("common.logIn")}</Link>
        <Link className="btn primary" href="/signup">{t("landing.startFree")}</Link>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-20">
        <section className="py-12 md:py-20">
          <h1 className="max-w-2xl text-4xl font-extrabold leading-tight md:text-5xl">{t("landing.heroTitle")}</h1>
          <p className="muted mt-4 max-w-xl text-lg">{t("landing.heroBody")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link className="btn primary" href="/signup">{t("landing.startTrial")}</Link>
            <a className="btn" href="#pricing">{t("landing.seePricing")}</a>
          </div>
          <p className="muted small mt-3">{t("landing.trialNote", { days: env().TRIAL_DAYS })}</p>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {features.map(([title, text]) => (
            <div key={title} className="card">
              <h2>{t(`landing.${title}`)}</h2>
              <p className="muted m-0">{t(`landing.${text}`)}</p>
            </div>
          ))}
        </section>

        <section id="pricing" className="py-16">
          <h2 className="mb-2 text-2xl font-extrabold">{t("landing.pricingTitle")}</h2>
          <p className="muted small mb-3">{kenya ? t("landing.pricingNoteKe") : t("landing.pricingNoteIntl")}</p>
          {pricing.methods.length > 0 && (
            <>
              <div className="small muted font-bold">{t("billing.waysToPay", { country: countryName })}</div>
              <div className="methods">{pricing.methods.map((m) => <span key={m} className="chip">{m}</span>)}</div>
            </>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            {pricing.plans.map((p) => (
              <div key={p.key} className={`card ${p.key === "yearly" ? "ring-2 ring-[var(--brand)]" : ""}`}>
                <div className="small muted font-bold uppercase">{t(`billing.${p.key}`)}{p.key === "yearly" ? ` · ${t("landing.bestValue")}` : ""}</div>
                <div className="num mt-2 text-3xl font-extrabold">
                  {kenya ? formatMoney(p.kes, "KES", locale) : (
                    <PaddlePrice priceId={p.paddlePriceId} country={pricing.country} token={config.paddleClientToken} env={config.paddleEnv}
                      fallback={<>
                        {formatMoney(p.usd, "USD", locale)}
                        {p.approxLocal !== null && <span className="approx">≈ {formatMoney(p.approxLocal, pricing.localCurrency, locale)}</span>}
                      </>} />
                  )}
                  <span className="small muted font-normal">{t(per[p.key])}</span>
                </div>
                <div className="muted small">{t("landing.daysAccess", { days: p.days })}</div>
                <Link className="btn primary full mt-4" href="/signup">{t("landing.startTrial")}</Link>
              </div>
            ))}
          </div>
          {showApprox && (
            <p className="muted small mt-4">
              {t("billing.approxNote", { currency: pricing.localCurrency })}{" "}
              <a href="https://www.exchangerate-api.com" rel="noopener noreferrer" target="_blank">Rates by Exchange Rate API</a>
            </p>
          )}
        </section>
      </main>

      <footer className="muted small mx-auto flex max-w-5xl flex-wrap gap-4 px-4 pb-10">
        <span>© {new Date().getFullYear()} PesaFlow · {t("landing.footer")}</span>
      </footer>
    </div>
  );
}
