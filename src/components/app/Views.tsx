"use client";

import { useMemo, useState } from "react";
import { useT } from "@/i18n/client";
import { weekday } from "@/lib/dates";
import { BalanceChart } from "./BalanceChart";
import type { Account, BudgetPayload, Item, Me } from "./types";
import { Money, tone, useFmt } from "./ui";

export interface ViewActions {
  openItem: (item?: Item) => void;
  openAccount: (account?: Account) => void;
  toggleDone: (item: Item) => void;
  openBilling: (reason?: string) => void;
  goto: (tab: "daily") => void;
}

export function SubscriptionBanner({ me, onRenew }: { me: Me; onRenew: () => void }) {
  const { t, tp } = useT();
  const s = me.subscription;
  if (!s.active) return <div className="alert bad">{t("sub.expiredBanner")} <button className="btn sm primary" onClick={onRenew}>{t("sub.renew")}</button></div>;
  if (s.onTrial && s.daysLeft <= 3) return <div className="alert warn">{tp("sub.trialEnding", s.daysLeft)} <button className="btn sm primary" onClick={onRenew}>{t("sub.subscribe")}</button></div>;
  return null;
}

export function useSchedule(currency: string) {
  const { t } = useT();
  const f = useFmt(currency);
  return (item: Item, effective?: string) => {
    const parts = [item.everyDays > 1 ? t("items.everyNDays", { count: item.everyDays }) : item.everyDays === 1 ? t("items.everyDay") : t("items.once")];
    if (effective) parts.push(t(item.everyDays > 0 ? "items.from" : "items.on", { date: f.date(effective) }));
    if (item.endDate) parts.push(t("items.until", { date: f.date(item.endDate) }));
    return parts.join(" ");
  };
}

// ---------------------------------------------------------------- Overview

export function Overview({ data, a }: { data: BudgetPayload; a: ViewActions }) {
  const { t, tp } = useT();
  const { projection: p, accounts, items, budget } = data;
  const cur = budget.currency;
  const f = useFmt(cur);
  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const upcoming = useMemo(() => {
    const rows: { date: string; item: Item; amt: number }[] = [];
    for (const d of p.days) {
      for (const [id, amt] of Object.entries(d.flows)) if (amt && byId[id]) rows.push({ date: d.date, item: byId[id]!, amt });
      if (rows.length >= 8) break;
    }
    return rows.slice(0, 8);
  }, [p, byId]);

  return (
    <>
      {p.firstNegativeDate ? (
        <div className="alert bad">{t("overview.goesNegative", { date: f.date(p.firstNegativeDate), amount: f.money(p.lowestBalance), lowDate: f.date(p.lowestDate) })}</div>
      ) : (
        <div className="alert ok">{tp("overview.staysPositive", p.horizon, { amount: f.money(p.lowestBalance), lowDate: f.date(p.lowestDate) })}</div>
      )}
      <div className="kpis">
        <div className="kpi"><div className="label">{t("overview.cashToday")}</div><div className="value"><Money minor={p.openingBalance} currency={cur} /></div>
          <div className="sub">{tp("overview.accountsCount", accounts.filter((x) => x.includeInTotal).length)}</div></div>
        <div className="kpi"><div className="label">{t("overview.surplus")}</div><div className="value"><Money minor={p.netFlow} currency={cur} sign /></div>
          <div className="sub">{t("overview.inOut", { in: f.money(p.totalIn), out: f.money(-p.totalOut) })}</div></div>
        <div className="kpi"><div className="label">{t("overview.bottomLine")}</div><div className="value"><Money minor={p.closingBalance} currency={cur} /></div>
          <div className="sub">{t("overview.onDate", { date: f.date(p.days.at(-1)!.date) })}</div></div>
        <div className="kpi"><div className="label">{t("overview.lowest")}</div><div className="value"><Money minor={p.lowestBalance} currency={cur} /></div>
          <div className="sub">{t("overview.onDate", { date: f.date(p.lowestDate) })}</div></div>
      </div>
      <div className="grid-2">
        <section className="card">
          <h2>{tp("overview.chartTitle", p.horizon)}</h2>
          <BalanceChart projection={p} currency={cur} />
        </section>
        <section className="card">
          <h2>{t("overview.accounts")} <button className="btn sm" onClick={() => a.openAccount()}>{t("common.add")}</button></h2>
          <ul className="list">
            {accounts.map((acc) => (
              <li key={acc.id} className="clickable" onClick={() => a.openAccount(acc)}>
                <div className="grow"><div className="title">{acc.name}</div>
                  <div className="meta">{acc.includeInTotal ? t("overview.counted") : t("overview.notCounted")}{acc.details ? ` · ${acc.details}` : ""}</div></div>
                <Money minor={acc.balance} currency={cur} />
              </li>
            ))}
            {!accounts.length && <li className="muted">{t("overview.noAccounts")}</li>}
          </ul>
          <div className="total-row"><span>{t("overview.cashToday")}</span><Money minor={p.openingBalance} currency={cur} /></div>
        </section>
      </div>
      <section className="card">
        <h2>{t("overview.comingUp")} <button className="btn sm" onClick={() => a.goto("daily")}>{t("overview.seeAllDays")}</button></h2>
        {upcoming.length ? (
          <ul className="list">
            {upcoming.map((r) => (
              <li key={`${r.date}-${r.item.id}`} className="clickable" onClick={() => a.openItem(r.item)}>
                <div className="grow"><div className="title">{r.item.name}</div>
                  <div className="meta">{f.date(r.date)}{r.date === p.today ? ` · ${t("common.today")}` : ""}</div></div>
                <Money minor={r.amt} currency={cur} sign />
              </li>
            ))}
          </ul>
        ) : <div className="empty">{t("overview.nothingScheduled")} <button className="btn sm" onClick={() => a.openItem()}>{t("overview.addItem")}</button></div>}
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Items

export function Items({ data, a }: { data: BudgetPayload; a: ViewActions }) {
  const { t } = useT();
  const { items, accounts, projection, budget } = data;
  const cur = budget.currency;
  const f = useFmt(cur);
  const schedule = useSchedule(cur);
  const [q, setQ] = useState("");
  const [showDone, setShowDone] = useState(true);
  const acct = Object.fromEntries(accounts.map((x) => [x.id, x.name]));
  const names = Object.fromEntries(items.map((x) => [x.id, x.name]));
  const query = q.trim().toLocaleLowerCase();
  const shown = items.filter((i) => (showDone || !i.done) && (!query || i.name.toLocaleLowerCase().includes(query) || i.note.toLocaleLowerCase().includes(query)));
  const pendingIn = items.filter((i) => !i.done && i.amount > 0).reduce((s, i) => s + i.amount, 0);
  const pendingOut = items.filter((i) => !i.done && i.amount < 0).reduce((s, i) => s + i.amount, 0);
  return (
    <>
      <div className="toolbar">
        <input type="search" placeholder={t("items.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("items.search")} />
        <label className="check small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> {t("items.showPaid")}</label>
        <button className="btn primary" onClick={() => a.openItem()}>{t("items.add")}</button>
      </div>
      <p className="small muted">{t("items.pending", { in: f.money(pendingIn), out: f.money(-pendingOut) })}</p>
      {shown.map((i) => (
        <div key={i.id} className={`item ${i.done ? "done" : ""}`}>
          <button className="tick" onClick={() => a.toggleDone(i)} aria-label={i.done ? t("items.markUnpaid") : t("items.markPaid")} title={i.done ? t("items.paidUndo") : t("items.markPaid")}>✓</button>
          <div className="body" onClick={() => a.openItem(i)}>
            <div className="title">{i.name}</div>
            <div className="meta">
              <span>{schedule(i, projection.effectiveDates[i.id])}</span>
              {i.accountId && acct[i.accountId] && <span className="chip">{acct[i.accountId]}</span>}
              {i.tieTo && names[i.tieTo] && <span className="chip tie">{t("items.waitsFor", { name: names[i.tieTo]! })}</span>}
              {i.note && <span>{i.note}</span>}
            </div>
          </div>
          <div className="amt"><Money minor={i.amount} currency={cur} sign /></div>
        </div>
      ))}
      {!shown.length && <div className="empty">{items.length ? t("items.noMatch") : t("items.empty")}</div>}
    </>
  );
}

// ---------------------------------------------------------------- Daily grid

export function Daily({ data }: { data: BudgetPayload }) {
  const { t } = useT();
  const { projection: p, items, budget } = data;
  const cur = budget.currency;
  const f = useFmt(cur);
  const [open, setOpen] = useState<string | null>(null);
  const cols = items.filter((i) => p.days.some((d) => d.flows[i.id]));
  const names = Object.fromEntries(items.map((i) => [i.id, i.name]));
  return (
    <>
      <div className="toolbar">
        <div className="small muted">{t("daily.opening", { amount: f.money(p.openingBalance) })}</div>
        <div className="spacer" />
        <a className="btn sm" href={`/api/budgets/${budget.id}/export`}>{t("daily.export")}</a>
        <button className="btn sm" onClick={() => window.print()}>{t("daily.print")}</button>
      </div>
      <div className="table-wrap">
        <table className="daygrid">
          <thead>
            <tr>
              <th className="l sticky">{t("daily.date")}</th>
              {cols.map((i) => <th key={i.id} className="item-col wide-only" title={i.name}>{i.name}</th>)}
              <th>{t("daily.net")}</th><th>{t("daily.balance")}</th>
            </tr>
          </thead>
          <tbody>
            {p.days.map((d) => {
              const flows = Object.entries(d.flows).filter(([, v]) => v);
              return [
                <tr key={d.date} className={`clickable ${d.date === p.today ? "today" : ""} ${[0, 6].includes(weekday(d.date)) ? "weekend" : ""} ${d.balance < 0 ? "negative" : ""}`}
                  onClick={() => setOpen(open === d.date ? null : d.date)}>
                  <td className="l sticky">{f.date(d.date)}</td>
                  {cols.map((i) => { const v = d.flows[i.id]; return <td key={i.id} className={`num wide-only ${v ? tone(v) : "muted"}`}>{v ? f.amount(v) : ""}</td>; })}
                  <td className={`num net ${tone(d.net)}`}>{d.net ? f.money(d.net, true) : "—"}</td>
                  <td className="num bal">{f.money(d.balance)}</td>
                </tr>,
                open === d.date && (
                  <tr key={`${d.date}-detail`} className="detail"><td colSpan={cols.length + 3}>
                    {flows.length ? flows.map(([id, v]) => <div key={id} className="flow-line"><span>{names[id]}</span><Money minor={v} currency={cur} sign /></div>)
                      : <span className="muted">{t("daily.nothing")}</span>}
                  </td></tr>
                ),
              ];
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="l sticky"><b>{t("daily.total")}</b></td>
              {cols.map((i) => { const s = p.days.reduce((tot, d) => tot + (d.flows[i.id] ?? 0), 0); return <td key={i.id} className={`num wide-only ${tone(s)}`}><b>{f.amount(s)}</b></td>; })}
              <td><b><Money minor={p.netFlow} currency={cur} sign /></b></td>
              <td><b><Money minor={p.closingBalance} currency={cur} /></b></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
