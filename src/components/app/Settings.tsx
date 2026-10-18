"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useT } from "@/i18n/client";
import { LOCALE_NAMES, LOCALES } from "@/i18n/core";
import { api } from "@/lib/api";
import { countryOptions } from "@/lib/countries";
import { formatMoney } from "@/lib/money";
import { CurrencySelect } from "./Dialogs";
import type { BudgetPayload, Me, Payment } from "./types";
import { FormError, useFmt } from "./ui";

export function timeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC", "Africa/Nairobi", "Africa/Lagos", "Europe/London", "Europe/Berlin", "America/New_York", "America/Sao_Paulo", "Asia/Kolkata"];
  }
}

export function Settings({ data, me, budgetsCount, onBudgetSaved, onCopy, onNew, onDelete, onBilling, onMe, onLogout, onLocaleChanged, toast }: {
  data: BudgetPayload; me: Me; budgetsCount: number;
  onBudgetSaved: (d: BudgetPayload) => void; onCopy: () => void; onNew: () => void; onDelete: () => void;
  onBilling: () => void; onMe: (u: Me) => void; onLogout: () => void; onLocaleChanged: () => void; toast: (m: string) => void;
}) {
  const { t, tMaybe, locale } = useT();
  const f = useFmt(data.budget.currency);
  const [history, setHistory] = useState<Payment[] | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const countries = useMemo(() => countryOptions(locale), [locale]);
  const zones = useMemo(timeZones, []);
  const run = (fn: () => Promise<void>) => fn().catch((e: Error) => e.message && toast(e.message));
  const fields = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); return Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>; };
  const card = me.card;
  const cardLive = !!card && ["active", "trialing", "past_due"].includes(card.status ?? "");

  return (
    <>
      <section className="card">
        <h2>{t("settings.thisBudget")}</h2>
        <form onSubmit={(e) => { const v = fields(e); run(async () => {
          onBudgetSaved(await api<BudgetPayload>("PUT", `/api/budgets/${data.budget.id}`, { name: v.name, horizonDays: Number(v.horizonDays), currency: v.currency }));
          toast(t("budget.saved"));
        }); }}>
          <label className="field"><span>{t("budget.name")}</span><input name="name" type="text" defaultValue={data.budget.name} required maxLength={80} /></label>
          <div className="row2">
            <label className="field"><span>{t("settings.horizon")}</span><input name="horizonDays" type="number" min={7} max={120} defaultValue={data.budget.horizonDays} />
              <div className="hint">{t("settings.horizonHint")}</div></label>
            <label className="field"><span>{t("common.currency")}</span><CurrencySelect name="currency" defaultValue={data.budget.currency} />
              <div className="hint">{t("settings.currencyHint")}</div></label>
          </div>
          <button className="btn primary" type="submit">{t("common.save")}</button>
        </form>
      </section>

      <section className="card">
        <h2>{t("settings.budgets")}</h2>
        <p className="small muted">{t("settings.budgetsHint")}</p>
        <div className="toolbar">
          <button className="btn" onClick={onCopy}>{t("settings.copy")}</button>
          <button className="btn" onClick={onNew}>{t("settings.new")}</button>
          <div className="spacer" />
          <button className="btn danger" onClick={onDelete} disabled={budgetsCount <= 1}>{t("settings.deleteBudget")}</button>
        </div>
      </section>

      <section className="card">
        <h2>{t("settings.subscription")}</h2>
        <p>{me.subscription.active
          ? <>{t("settings.accessUntil", { date: f.longDate(me.subscription.accessUntil) })} {me.subscription.onTrial ? t("settings.trial") : ""}</>
          : <><span className="neg">{t("settings.expired")}</span> {t("settings.expiredHint")}</>}</p>
        {card && <p className="small muted">{cardLive && card.status !== "canceled" ? t("billing.cardRenews") : t("billing.cardCanceled")}</p>}
        <div className="toolbar">
          {!cardLive && <button className="btn primary" onClick={onBilling}>{t("settings.pay")}</button>}
          {card?.manageUrl && <a className="btn" href={card.manageUrl} target="_blank" rel="noopener noreferrer">{t("billing.manage")}</a>}
          {cardLive && card?.cancelUrl && <a className="btn danger" href={card.cancelUrl} target="_blank" rel="noopener noreferrer">{t("billing.cancelSub")}</a>}
          <button className="btn" onClick={() => run(async () => setHistory((await api<{ payments: Payment[] }>("GET", "/api/billing/payments")).payments))}>{t("settings.history")}</button>
        </div>
        {history && (history.length ? (
          <ul className="list">
            {history.map((p) => (
              <li key={p.id}>
                <div className="grow"><div className="title">{t(`billing.${p.plan as "monthly"}`)} · {formatMoney(p.amount, p.currency, locale)}</div>
                  <div className="meta">{new Date(p.createdAt).toLocaleString(locale === "en" ? "en-GB" : locale, { dateStyle: "medium", timeStyle: "short" })}
                    {p.provider === "mpesa" ? ` · M-Pesa ${p.phone}` : " · Paddle"}{p.receipt ? ` · ${p.receipt}` : ""}
                    {p.status === "failed" && p.resultDesc ? ` · ${tMaybe(p.resultDesc)}` : ""}</div></div>
                <span className={`chip ${p.status === "success" ? "" : "tie"}`}>{t(`status.${p.status}`)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted small">{t("settings.noPayments")}</p>)}
      </section>

      <section className="card">
        <h2>{t("settings.regional")}</h2>
        <p className="small muted">{t("settings.regionalHint")}</p>
        <form onSubmit={(e) => { const v = fields(e); run(async () => {
          const { user } = await api<{ user: Me }>("PUT", "/api/me", { locale: v.locale, country: v.country, timezone: v.timezone });
          onMe(user);
          toast(t("settings.profileSaved"));
          if (user.locale !== locale) onLocaleChanged();
        }); }}>
          <div className="row2">
            <label className="field"><span>{t("common.language")}</span>
              <select name="locale" defaultValue={me.locale}>{LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}</select></label>
            <label className="field"><span>{t("common.country")}</span>
              <select name="country" defaultValue={me.country}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
          </div>
          <label className="field"><span>{t("common.timezone")}</span>
            <select name="timezone" defaultValue={me.timezone}>{zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</select></label>
          <button className="btn" type="submit">{t("common.save")}</button>
        </form>
      </section>

      <section className="card">
        <h2>{t("settings.profile")}</h2>
        <form onSubmit={(e) => { const v = fields(e); run(async () => { onMe((await api<{ user: Me }>("PUT", "/api/me", { name: v.name, phone: v.phone })).user); toast(t("settings.profileSaved")); }); }}>
          <div className="row2">
            <label className="field"><span>{t("auth.name")}</span><input name="name" type="text" defaultValue={me.name} required /></label>
            <label className="field"><span>{t("auth.phone")}</span><input name="phone" type="tel" defaultValue={me.phoneDisplay} placeholder="+254 712 345 678" />
              <div className="hint">{t("auth.phoneHint")}</div></label>
          </div>
          <p className="small muted">{t("settings.signedInAs", { email: me.email })}</p>
          <button className="btn" type="submit">{t("settings.saveProfile")}</button>
        </form>
      </section>

      <section className="card">
        <h2>{t("settings.password")}</h2>
        <form onSubmit={(e) => { const form = e.currentTarget; const v = fields(e); run(async () => {
          await api("POST", "/api/me/password", { current: v.current, next: v.next });
          form.reset();
          toast(t("settings.passwordChanged"));
        }); }}>
          <div className="row2">
            <label className="field"><span>{t("settings.currentPassword")}</span><input name="current" type="password" autoComplete="current-password" required /></label>
            <label className="field"><span>{t("auth.newPassword")}</span><input name="next" type="password" autoComplete="new-password" minLength={8} required /></label>
          </div>
          <button className="btn" type="submit">{t("settings.changePassword")}</button>
        </form>
      </section>

      <section className="card">
        <h2>{t("settings.privacy")}</h2>
        <p className="small muted">{t("settings.exportHint")}</p>
        <div className="toolbar"><a className="btn" href="/api/me/export">{t("settings.exportData")}</a></div>
        <p className="small muted">{t("settings.deleteHint")}</p>
        <form onSubmit={(e) => { const v = fields(e); setDeleteError(""); api("DELETE", "/api/me", { password: v.password })
          .then(() => { toast(t("settings.deleted")); onLogout(); })
          .catch((err: Error) => setDeleteError(err.message)); }}>
          <FormError message={deleteError} />
          <label className="field"><span>{t("settings.deleteConfirm")}</span><input name="password" type="password" autoComplete="current-password" required /></label>
          <button className="btn danger" type="submit">{t("settings.deleteAccount")}</button>
        </form>
      </section>

      <div className="toolbar"><div className="spacer" /><button className="btn danger" onClick={onLogout}>{t("common.logOut")}</button></div>
    </>
  );
}
