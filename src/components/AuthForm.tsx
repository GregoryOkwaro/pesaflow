"use client";

import Link from "next/link";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api";
import { isCountry } from "@/lib/countries";
import { LanguageSwitcher } from "./LanguageSwitcher";

type Mode = "signup" | "login" | "reset";

/**
 * `countries` is localized on the server and passed down: Node and browsers ship different
 * CLDR versions, so names computed on both sides can differ and break hydration.
 */
export function AuthForm({ mode, turnstileSiteKey, countryHint, countries = [] }: {
  mode: Mode; turnstileSiteKey?: string; countryHint?: string | null; countries?: { code: string; name: string }[];
}) {
  const { t, locale } = useT();
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [sentMessage, setSentMessage] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [country, setCountry] = useState(isCountry(countryHint) ? countryHint! : "");

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) setTimezone(tz);
    if (!country) {
      // No hint from the server: guess from the browser's language region ("fr-CA" -> CA).
      const region = navigator.language.split("-")[1]?.toUpperCase();
      setCountry(isCountry(region) ? region! : "KE");
    }
  }, [country]);

  const turnstileToken = (form: HTMLFormElement) =>
    (form.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement | null)?.value || undefined;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setBusy(true);
    setError("");
    try {
      if (mode === "signup") {
        await api("POST", "/api/auth/signup", {
          name: f.name, email: f.email, phone: f.phone, password: f.password,
          country: f.country, timezone, locale, turnstileToken: turnstileToken(form),
        });
        router.replace("/app");
      } else if (mode === "login") {
        await api("POST", "/api/auth/login", { email: f.email, password: f.password });
        router.replace("/app");
      } else if (!sentMessage) {
        const res = await api<{ message: string }>("POST", "/api/auth/reset/request", { email: f.email, turnstileToken: turnstileToken(form) });
        setResetEmail(f.email!.trim());
        setSentMessage(res.message);
        setBusy(false);
      } else {
        await api("POST", "/api/auth/reset/confirm", { email: resetEmail, code: f.code, newPassword: f.newPassword });
        router.replace("/app?reset=1");
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const title = mode === "signup" ? t("auth.signupTitle") : mode === "login" ? t("auth.loginTitle") : t("auth.resetTitle");
  const lead = mode === "signup" ? t("auth.signupLead") : mode === "login" ? t("auth.loginLead") : sentMessage || t("auth.resetLead");

  return (
    <div className="auth"><div className="auth-card">
      <div className="flex items-center gap-3">
        <Link href="/" className="brand no-underline text-inherit"><img src="/icon.svg" alt="" /> PesaFlow</Link>
        <div className="flex-1" />
        <LanguageSwitcher />
      </div>
      <h1>{title}</h1>
      <p className="lead">{lead}</p>
      <div className="card">
        {mode !== "reset" && (
          <div className="tabs" role="tablist">
            <Link href="/signup" className={`tab ${mode === "signup" ? "on" : ""}`}>{t("auth.createAccount")}</Link>
            <Link href="/login" className={`tab ${mode === "login" ? "on" : ""}`}>{t("common.logIn")}</Link>
          </div>
        )}
        <form onSubmit={submit} noValidate key={sentMessage ? "step2" : "step1"}>
          {error && <div className="form-error" role="alert">{error}</div>}
          {mode === "signup" && (
            <>
              <label className="field"><span>{t("auth.name")}</span><input name="name" type="text" autoComplete="name" required /></label>
              <label className="field"><span>{t("common.country")}</span>
                <select name="country" value={country} onChange={(e) => setCountry(e.target.value)} autoComplete="country">
                  {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select></label>
              <label className="field"><span>{t("auth.phone")}</span>
                <input name="phone" type="tel" inputMode="tel" placeholder={country === "KE" ? "07XX XXX XXX" : "+"} autoComplete="tel" />
                <div className="hint">{t("auth.phoneHint")}</div></label>
            </>
          )}
          <label className="field"><span>{t("auth.email")}</span>
            <input name="email" type="email" autoComplete="email" required defaultValue={resetEmail} readOnly={!!sentMessage} autoFocus={mode !== "signup" && !sentMessage} />
          </label>
          {mode !== "reset" && (
            <label className="field"><span>{t("auth.password")}</span>
              <input name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} required />
              {mode === "signup" && <div className="hint">{t("auth.passwordHint")}</div>}
            </label>
          )}
          {mode === "reset" && sentMessage && (
            <>
              <label className="field"><span>{t("auth.code")}</span><input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus /></label>
              <label className="field"><span>{t("auth.newPassword")}</span><input name="newPassword" type="password" autoComplete="new-password" minLength={8} required />
                <div className="hint">{t("auth.newPasswordHint")}</div></label>
            </>
          )}
          {turnstileSiteKey && (mode === "signup" || (mode === "reset" && !sentMessage)) && (
            <>
              <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
              <div className="cf-turnstile mb-3" data-sitekey={turnstileSiteKey} data-language={locale} />
            </>
          )}
          <button className="btn primary full" type="submit" disabled={busy}>
            {mode === "signup" ? t("auth.startTrial") : mode === "login" ? t("common.logIn") : sentMessage ? t("auth.setPassword") : t("auth.sendCode")}
          </button>
          <p className="center small">
            {mode === "login" && <Link href="/reset">{t("auth.forgot")}</Link>}
            {mode === "reset" && (
              <>
                {sentMessage && <><a href="#" onClick={(e) => { e.preventDefault(); setSentMessage(""); setError(""); }}>{t("auth.resend")}</a> · </>}
                <Link href="/login">{t("auth.backToLogin")}</Link>
              </>
            )}
          </p>
        </form>
      </div>
      {mode === "signup" && (
        <ul className="perks">
          <li>{t("auth.perk1")}</li>
          <li>{t("auth.perk2")}</li>
          <li>{t("auth.perk3")}</li>
        </ul>
      )}
    </div></div>
  );
}
