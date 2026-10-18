"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useT } from "@/i18n/client";
import { api, ApiClientError } from "@/lib/api";
import { CURRENCY_CODES, currencyName } from "@/lib/countries";
import { currencyExponent, formatMoney, normalizeAmountInput, toInputString } from "@/lib/money";
import { loadPaddle, paddleLocale, setPaddleEventHandler } from "./paddle";
import { PaddlePrice } from "../PaddlePrice";
import type { Account, BudgetPayload, Item, Me, Payment, PaymentConfig, Plan, Pricing } from "./types";
import { FormError, Modal, useFmt } from "./ui";

const errMsg = (e: unknown) => (e instanceof ApiClientError && e.status === 402 ? "" : (e as Error).message);
const amountPattern = (currency: string, signed: boolean) => {
  const exp = currencyExponent(currency);
  return new RegExp(`^${signed ? "-?" : ""}\\d*${exp > 0 ? `(\\.\\d{0,${exp}})?` : ""}$`);
};

// ---------------------------------------------------------------- item

export function ItemDialog({ data, item, onSaved, onDelete, onClose }: {
  data: BudgetPayload; item?: Item; onSaved: (d: BudgetPayload, msg: string) => void; onDelete: (item: Item) => void; onClose: () => void;
}) {
  const { t, locale } = useT();
  const cur = data.budget.currency;
  const isNew = !item;
  const presets: [string, string][] = [["0", t("itemDialog.once")], ["1", t("itemDialog.daily")], ["7", t("itemDialog.weekly")], ["14", t("itemDialog.fortnightly")], ["30", t("itemDialog.monthly")]];
  const [dir, setDir] = useState<"in" | "out">(item && item.amount > 0 ? "in" : "out");
  const [every, setEvery] = useState(String(item?.everyDays ?? 0));
  const [preset, setPreset] = useState(presets.some(([v]) => v === String(item?.everyDays ?? 0)) ? String(item?.everyDays ?? 0) : "custom");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const others = data.items.filter((i) => i.id !== item?.id);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const raw = normalizeAmountInput(f.amount ?? "", locale);
    if (raw && !amountPattern(cur, false).test(raw)) {
      return setError(currencyExponent(cur) === 0 || raw.includes(".")
        ? t("errors.amountDecimals", { currency: cur, decimals: currencyExponent(cur) }) : t("errors.amountInvalid"));
    }
    const everyDays = Number(every) || 0;
    const body = {
      name: f.name, amount: raw ? (dir === "out" ? "-" : "") + raw : "0", valueDate: f.valueDate || null, everyDays,
      endDate: everyDays > 0 ? f.endDate || null : null, accountId: f.accountId || null, tieTo: f.tieTo || null,
      note: f.note ?? "", done: f.done === "on",
    };
    setBusy(true);
    try {
      const d = await api<BudgetPayload>(isNew ? "POST" : "PUT", isNew ? `/api/budgets/${data.budget.id}/items` : `/api/items/${item!.id}`, body);
      onSaved(d, isNew ? t("items.added") : t("items.saved"));
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={isNew ? t("itemDialog.addTitle") : t("itemDialog.editTitle")} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <FormError message={error} />
        <label className="field"><span>{t("itemDialog.what")}</span><input name="name" type="text" defaultValue={item?.name} placeholder={t("itemDialog.whatPlaceholder")} required maxLength={120} /></label>
        <div className="field"><span className="small muted"><b>{t("itemDialog.money")}</b></span>
          <div className="toolbar">
            <div className="seg" role="group" aria-label={t("itemDialog.money")}>
              <button type="button" className={`out ${dir === "out" ? "on" : ""}`} onClick={() => setDir("out")}>{t("itemDialog.out")}</button>
              <button type="button" className={`in ${dir === "in" ? "on" : ""}`} onClick={() => setDir("in")}>{t("itemDialog.in")}</button>
            </div>
          </div>
          <input name="amount" type="text" inputMode="decimal" aria-label={t("itemDialog.amount", { currency: cur })} placeholder={t("itemDialog.amount", { currency: cur })}
            defaultValue={item?.amount ? toInputString(Math.abs(item.amount), cur, locale) : ""} />
        </div>
        <div className="row2">
          <label className="field"><span>{t("itemDialog.due")}</span><input name="valueDate" type="date" defaultValue={item ? item.valueDate ?? "" : data.projection.today} />
            <div className="hint">{t("itemDialog.dueHint")}</div></label>
          <label className="field"><span>{t("itemDialog.repeats")}</span>
            <select value={preset} onChange={(e) => { setPreset(e.target.value); if (e.target.value !== "custom") setEvery(e.target.value); }}>
              {presets.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              <option value="custom">{t("itemDialog.custom")}</option>
            </select></label>
        </div>
        <div className="row2">
          {preset === "custom" && <label className="field"><span>{t("itemDialog.everyDays")}</span><input type="number" min={0} max={366} value={every} onChange={(e) => setEvery(e.target.value)} /></label>}
          {Number(every) > 0 && <label className="field"><span>{t("itemDialog.stopAfter")}</span><input name="endDate" type="date" defaultValue={item?.endDate ?? ""} /><div className="hint">{t("itemDialog.stopHint")}</div></label>}
        </div>
        <div className="row2">
          <label className="field"><span>{t("itemDialog.account")}</span>
            <select name="accountId" defaultValue={item ? item.accountId ?? "" : data.accounts[0]?.id ?? ""}>
              <option value="">—</option>
              {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></label>
          <label className="field"><span>{t("itemDialog.waitFor")}</span>
            <select name="tieTo" defaultValue={item?.tieTo ?? ""}>
              <option value="">{t("itemDialog.notTied")}</option>
              {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <div className="hint">{t("itemDialog.waitHint")}</div></label>
        </div>
        <label className="field"><span>{t("itemDialog.note")}</span><textarea name="note" maxLength={500} defaultValue={item?.note} placeholder={t("itemDialog.notePlaceholder")} /></label>
        <label className="check"><input type="checkbox" name="done" defaultChecked={item?.done} /> {t("itemDialog.done")}</label>
        <div className="actions">
          <button className="btn primary" type="submit" disabled={busy}>{isNew ? t("itemDialog.addTitle") : t("common.save")}</button>
          <button className="btn" type="button" onClick={onClose}>{t("common.cancel")}</button>
          <div className="spacer" />
          {!isNew && <button className="btn danger" type="button" onClick={() => onDelete(item!)}>{t("common.delete")}</button>}
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- account

export function AccountDialog({ budgetId, currency, account, onSaved, onDelete, onClose }: {
  budgetId: string; currency: string; account?: Account; onSaved: (d: BudgetPayload, msg: string) => void; onDelete: (a: Account) => void; onClose: () => void;
}) {
  const { t, locale } = useT();
  const isNew = !account;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const raw = normalizeAmountInput(f.balance ?? "", locale);
    if (raw && !amountPattern(currency, true).test(raw)) return setError(t("errors.amountInvalid"));
    setBusy(true);
    try {
      const d = await api<BudgetPayload>(isNew ? "POST" : "PUT", isNew ? `/api/budgets/${budgetId}/accounts` : `/api/accounts/${account!.id}`,
        { name: f.name, balance: raw || "0", details: f.details ?? "", includeInTotal: f.includeInTotal === "on" });
      onSaved(d, t("accountDialog.saved"));
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }
  return (
    <Modal title={isNew ? t("accountDialog.addTitle") : t("accountDialog.editTitle")} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <FormError message={error} />
        <label className="field"><span>{t("accountDialog.name")}</span><input name="name" type="text" defaultValue={account?.name} placeholder={t("accountDialog.namePlaceholder")} required maxLength={60} /></label>
        <label className="field"><span>{t("accountDialog.balance", { currency })}</span>
          <input name="balance" type="text" inputMode="decimal" defaultValue={account ? toInputString(account.balance, currency, locale) : "0"} />
          <div className="hint">{t("accountDialog.balanceHint")}</div></label>
        <label className="field"><span>{t("accountDialog.details")}</span><input name="details" type="text" defaultValue={account?.details} maxLength={200} placeholder={t("accountDialog.detailsPlaceholder")} /></label>
        <label className="check"><input type="checkbox" name="includeInTotal" defaultChecked={account?.includeInTotal ?? true} /> {t("accountDialog.include")}</label>
        <p className="hint">{t("accountDialog.includeHint")}</p>
        <div className="actions">
          <button className="btn primary" type="submit" disabled={busy}>{isNew ? t("accountDialog.addTitle") : t("common.save")}</button>
          <button className="btn" type="button" onClick={onClose}>{t("common.cancel")}</button>
          <div className="spacer" />
          {!isNew && <button className="btn danger" type="button" onClick={() => onDelete(account!)}>{t("common.delete")}</button>}
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- budget

export function CurrencySelect({ name, defaultValue }: { name: string; defaultValue: string }) {
  const { locale } = useT();
  return (
    <select name={name} defaultValue={defaultValue}>
      {CURRENCY_CODES.map((c) => <option key={c} value={c}>{c} · {currencyName(c, locale)}</option>)}
    </select>
  );
}

export function NewBudgetDialog({ copyFrom, suggested, defaultCurrency, onCreated, onClose }: {
  copyFrom?: string; suggested: string; defaultCurrency: string; onCreated: (d: BudgetPayload) => void; onClose: () => void;
}) {
  const { t } = useT();
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      onCreated(await api<BudgetPayload>("POST", "/api/budgets", { name: f.name, copyFrom, currency: copyFrom ? undefined : f.currency }));
    } catch (err) {
      setError(errMsg(err));
    }
  }
  return (
    <Modal title={copyFrom ? t("budget.copyTitle") : t("budget.newTitle")} onClose={onClose}>
      <form onSubmit={submit}>
        <FormError message={error} />
        <label className="field"><span>{t("budget.name")}</span><input name="name" type="text" defaultValue={suggested} required maxLength={80} /></label>
        {!copyFrom && <label className="field"><span>{t("common.currency")}</span><CurrencySelect name="currency" defaultValue={defaultCurrency} /></label>}
        <div className="actions"><button className="btn primary" type="submit">{t("common.create")}</button><button className="btn" type="button" onClick={onClose}>{t("common.cancel")}</button></div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- billing (M-Pesa + Paddle)

export function BillingDialog({ me, plans, pricing, config, reason, resume, onUser, onClose }: {
  me: Me; plans: Plan[]; pricing: Pricing; config: PaymentConfig; reason?: string;
  resume?: { id: string; cancelled: boolean }; // back from the mobile money checkout
  onUser: (u: Me) => void; onClose: () => void;
}) {
  const { t, tMaybe, locale } = useT();
  const f = useFmt("KES");
  const kenya = me.country === "KE";
  const momo = pricing.mobileMoney;
  const methods = ([kenya && "mpesa", momo && "momo", config.cardEnabled && "card"] as const).filter((m): m is "mpesa" | "momo" | "card" => !!m);
  const [method, setMethod] = useState<"mpesa" | "momo" | "card">(methods[0] ?? "card");
  const [plan, setPlan] = useState<Plan["key"]>("yearly");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<Payment | null>(null);
  const [cardPending, setCardPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; desc?: string; receipt?: string; user: Me } | null>(null);
  const [slow, setSlow] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const s = me.subscription;
  const cardActive = !!me.card && ["active", "trialing", "past_due"].includes(me.card.status ?? "");

  useEffect(() => () => { clearInterval(timer.current); setPaddleEventHandler(null); }, []);

  // Returning from the mobile money checkout: show where that payment stands.
  useEffect(() => {
    if (!resume) return;
    setMethod("momo");
    api<{ payment: Payment; user: Me }>("GET", `/api/billing/payments/${resume.id}`).then((res) => {
      if (res.payment.status === "pending" && !resume.cancelled) return setWaiting(res.payment);
      onUser(res.user);
      setResult({ ok: res.payment.status === "success", desc: res.payment.status === "failed" ? res.payment.resultDesc : undefined, receipt: res.payment.receipt, user: res.user });
    }).catch((err) => setError((err as Error).message));
  }, [resume, onUser]);

  // M-Pesa: poll our payment until the callback (or status query) settles it.
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    timer.current = setInterval(async () => {
      try {
        const res = await api<{ payment: Payment; user: Me }>("GET", `/api/billing/payments/${waiting.id}`);
        if (res.payment.status === "pending") {
          if (Date.now() - started > 150_000) { clearInterval(timer.current); setSlow(true); }
          return;
        }
        clearInterval(timer.current);
        onUser(res.user);
        setResult({ ok: res.payment.status === "success", desc: res.payment.resultDesc, receipt: res.payment.receipt, user: res.user });
      } catch { /* transient: keep polling */ }
    }, 3000);
    return () => clearInterval(timer.current);
  }, [waiting, onUser]);

  // Card: after Paddle reports checkout.completed, wait for our webhook to extend access.
  const pollUntilPaid = useCallback(() => {
    const before = me.subscription.accessUntil;
    const started = Date.now();
    setCardPending(true);
    clearInterval(timer.current);
    timer.current = setInterval(async () => {
      try {
        const { user } = await api<{ user: Me }>("GET", "/api/me");
        if (user.subscription.accessUntil > before || (user.card && user.card.status === "active")) {
          clearInterval(timer.current);
          onUser(user);
          setResult({ ok: true, user });
        } else if (Date.now() - started > 90_000) {
          clearInterval(timer.current);
          setSlow(true);
        }
      } catch { /* keep polling */ }
    }, 3000);
  }, [me.subscription.accessUntil, onUser]);

  async function payMpesa(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { payment } = await api<{ payment: Payment }>("POST", "/api/billing/subscribe", { plan, phone: new FormData(e.currentTarget).get("phone") });
      setWaiting(payment);
    } catch (err) {
      setError((err as Error).message); // already translated by the server
      setBusy(false);
    }
  }

  async function payMobile() {
    setBusy(true);
    setError("");
    try {
      const { redirectUrl } = await api<{ payment: Payment; redirectUrl: string }>("POST", "/api/billing/mobile", { plan });
      window.location.assign(redirectUrl); // Flutterwave's page (mock mode: straight back here)
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function payCard() {
    setBusy(true);
    setError("");
    try {
      const res = await api<{ mode: string; user?: Me; priceId?: string; customer?: Record<string, string>; customData?: Record<string, string> }>("POST", "/api/billing/card", { plan });
      if (res.mode === "mock" && res.user) {
        onUser(res.user);
        setResult({ ok: true, user: res.user });
        return;
      }
      const paddle = await loadPaddle(config.paddleClientToken!, config.paddleEnv);
      setPaddleEventHandler((ev) => {
        if (ev.name === "checkout.completed") { paddle.Checkout.close(); pollUntilPaid(); }
        if (ev.name === "checkout.closed") setBusy(false);
      });
      paddle.Checkout.open({
        items: [{ priceId: res.priceId, quantity: 1 }],
        customer: res.customer,
        customData: res.customData,
        settings: { displayMode: "overlay", locale: paddleLocale(locale), theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light" },
      });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const approx = (key: Plan["key"]) => pricing.plans.find((x) => x.key === key)?.approxLocal ?? null;
  const priceLabel = (p: Plan) => {
    if (method === "mpesa") return f.money(p.kes);
    if (method === "momo" && momo) return formatMoney(momo.prices[p.key], momo.currency, locale);
    const a = approx(p.key);
    return (
      <PaddlePrice priceId={p.paddlePriceId} country={pricing.country} token={config.paddleClientToken} env={config.paddleEnv}
        fallback={<>{formatMoney(p.usd, "USD", locale)}{a !== null && <span className="approx">≈ {formatMoney(a, pricing.localCurrency, locale)}</span>}</>} />
    );
  };
  const countryName = (() => {
    try { return new Intl.DisplayNames([locale, "en"], { type: "region" }).of(pricing.country) ?? pricing.country; } catch { return pricing.country; }
  })();
  const per = (k: Plan["key"]) => t(k === "monthly" ? "billing.perMonth" : k === "quarterly" ? "billing.perQuarter" : "billing.perYear");

  let content;
  if (result?.ok) {
    content = (
      <div className="mpesa-wait">
        <div className="alert ok">{t("billing.received")}{result.receipt ? ` · ${result.receipt}` : ""}</div>
        <p>{t("billing.allSet", { date: f.longDate(result.user.subscription.accessUntil) })}</p>
        <button className="btn primary full" onClick={onClose}>{t("common.continue")}</button>
      </div>
    );
  } else if (result) {
    content = (
      <div className="mpesa-wait">
        <div className="alert bad">{t("billing.failed")}</div>
        <p className="small muted">{result.desc ? tMaybe(result.desc) : t("billing.failedHint")}</p>
        <button className="btn primary full" onClick={() => { setResult(null); setWaiting(null); setBusy(false); }}>{t("common.tryAgain")}</button>
      </div>
    );
  } else if (waiting || cardPending) {
    content = (
      <div className="mpesa-wait">
        <div className="spinner" />
        <p><b>{!waiting ? t("billing.cardDone") : waiting.provider === "flutterwave" ? t("billing.mobileWaiting") : t("billing.checkPhone")}</b></p>
        {waiting && <p className="small muted">{waiting.provider === "flutterwave"
          ? formatMoney(waiting.amount, waiting.currency, locale)
          : t("billing.sentTo", { phone: waiting.phone, amount: formatMoney(waiting.amount, waiting.currency, locale) })}</p>}
        <p className="small muted">{slow ? t("billing.slow") : t("billing.waiting")}</p>
      </div>
    );
  } else {
    content = (
      <>
        {reason && <div className="alert warn">{reason}</div>}
        <p className="small muted">{s.active ? t("billing.activeUntil", { date: f.longDate(s.accessUntil) }) : t("billing.choose")}</p>
        {methods.length > 1 && (
          <div className="tabs" role="tablist">
            {methods.map((m) => (
              <button key={m} type="button" role="tab" aria-selected={method === m} className={method === m ? "on" : ""} onClick={() => setMethod(m)}>
                {m === "mpesa" ? "M-Pesa" : m === "momo" ? t("billing.mobileTab") : t("billing.payCard")}
              </button>
            ))}
          </div>
        )}
        <FormError message={error} />
        <div className="plans" role="radiogroup">
          {plans.map((p) => (
            <label key={p.key} className={`plan ${plan === p.key ? "on" : ""}`}>
              <input type="radio" name="plan" value={p.key} checked={plan === p.key} onChange={() => setPlan(p.key)} />
              <div><b>{t(`billing.${p.key}`)}</b><div className="small muted">{t("billing.days", { days: p.days })}{p.key === "yearly" ? ` · ${t("billing.bestValue")}` : ""}</div></div>
              <div className="price num">{priceLabel(p)}<span className="small muted">{per(p.key)}</span></div>
            </label>
          ))}
        </div>
        {method === "mpesa" ? (
          <form onSubmit={payMpesa} noValidate>
            <label className="field"><span>{t("billing.mpesaNumber")}</span><input name="phone" type="tel" inputMode="tel" defaultValue={me.phone.startsWith("254") ? me.phoneDisplay : ""} placeholder="07XX XXX XXX" required /></label>
            <button className="btn primary full" type="submit" disabled={busy}>{t("billing.sendPrompt")}</button>
            <p className="hint">{t("billing.mpesaHint")}{config.mpesaEnv === "mock" && <b> {t("billing.testMode")}</b>}{config.mpesaEnv === "sandbox" && <b> {t("billing.sandboxMode")}</b>}</p>
          </form>
        ) : method === "momo" && momo ? (
          <>
            <div className="methods">{momo.networks.map((n) => <span key={n} className="chip">{n}</span>)}</div>
            <button className="btn primary full" onClick={payMobile} disabled={busy}>
              {t("billing.mobileButton", { amount: formatMoney(momo.prices[plan], momo.currency, locale) })}
            </button>
            <p className="hint">{t("billing.mobileHint")}{config.mobileMoneyEnv === "mock" && <b> {t("billing.testMode")}</b>}{config.mobileMoneyEnv === "test" && <b> {t("billing.sandboxMode")}</b>}</p>
          </>
        ) : (
          <>
            {cardActive ? <div className="alert ok">{t("billing.cardRenews")}</div> : (
              <button className="btn primary full" onClick={payCard} disabled={busy || !config.cardEnabled}>{config.cardEnabled ? t("billing.payCard") : t("errors.cardUnavailable")}</button>
            )}
            {pricing.methods.length > 0 && (
              <>
                <div className="small muted font-bold">{t("billing.waysToPay", { country: countryName })}</div>
                <div className="methods">{pricing.methods.filter((m) => m !== "M-Pesa" && !momo?.networks.includes(m)).map((m) => <span key={m} className="chip">{m}</span>)}</div>
              </>
            )}
            <p className="hint">{t("billing.cardHint")}{config.paddleEnv === "mock" && <b> {t("billing.testMode")}</b>}{config.paddleEnv === "sandbox" && <b> {t("billing.sandboxMode")}</b>}</p>
            {pricing.plans.some((x) => x.approxLocal !== null) && <p className="hint">{t("billing.approxNote", { currency: pricing.localCurrency })}</p>}
          </>
        )}
      </>
    );
  }
  const idle = !result && !waiting;
  const title = idle && method === "mpesa" ? t("billing.payMpesa") : idle && method === "momo" ? t("billing.payMobile") : t("billing.title");
  return <Modal title={title} onClose={onClose}>{content}</Modal>;
}
