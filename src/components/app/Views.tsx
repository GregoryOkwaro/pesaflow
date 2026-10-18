"use client";

import { useMemo, useState } from "react";
import { formatDate, weekday } from "@/lib/dates";
import { formatKes, formatPlain } from "@/lib/money";
import { BalanceChart } from "./BalanceChart";
import type { Account, BudgetPayload, Item, Me } from "./types";
import { Kes, tone } from "./ui";

export interface ViewActions {
  openItem: (item?: Item) => void;
  openAccount: (account?: Account) => void;
  toggleDone: (item: Item) => void;
  openBilling: (reason?: string) => void;
  goto: (tab: "daily") => void;
}

export function SubscriptionBanner({ me, onRenew }: { me: Me; onRenew: () => void }) {
  const s = me.subscription;
  if (!s.active) return <div className="alert bad">Your subscription has ended. Your budget is read-only. <button className="btn sm primary" onClick={onRenew}>Renew with M-Pesa</button></div>;
  if (s.onTrial && s.daysLeft <= 3) return <div className="alert warn">Your free trial ends in {s.daysLeft} day{s.daysLeft === 1 ? "" : "s"}. <button className="btn sm primary" onClick={onRenew}>Subscribe</button></div>;
  return null;
}

export function schedule(item: Item, effective?: string) {
  const parts = [item.everyDays > 0 ? `Every ${item.everyDays === 1 ? "day" : `${item.everyDays} days`}` : "Once"];
  if (effective) parts.push(`${item.everyDays > 0 ? "from" : "on"} ${formatDate(effective)}`);
  if (item.endDate) parts.push(`until ${formatDate(item.endDate)}`);
  return parts.join(" ");
}

// ---------------------------------------------------------------- Overview

export function Overview({ data, a }: { data: BudgetPayload; a: ViewActions }) {
  const { projection: p, accounts, items } = data;
  const names = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const upcoming = useMemo(() => {
    const rows: { date: string; item: Item; amt: number }[] = [];
    for (const d of p.days) {
      for (const [id, amt] of Object.entries(d.flows)) if (amt && names[id]) rows.push({ date: d.date, item: names[id]!, amt });
      if (rows.length >= 8) break;
    }
    return rows.slice(0, 8);
  }, [p, names]);

  return (
    <>
      {p.firstNegativeDate ? (
        <div className="alert bad">⚠ Your balance goes negative on {formatDate(p.firstNegativeDate)} and bottoms out at {formatKes(p.lowestBalance)} on {formatDate(p.lowestDate)}.</div>
      ) : (
        <div className="alert ok">✓ You stay above zero for the next {p.horizon} days. Lowest point: {formatKes(p.lowestBalance)} on {formatDate(p.lowestDate)}.</div>
      )}
      <div className="kpis">
        <div className="kpi"><div className="label">Cash today</div><div className="value"><Kes cents={p.openingBalance} /></div><div className="sub">{accounts.filter((x) => x.includeInTotal).length} account(s)</div></div>
        <div className="kpi"><div className="label">Budget surplus / deficit</div><div className="value"><Kes cents={p.netFlow} sign /></div><div className="sub">In {formatKes(p.totalIn)} · Out {formatKes(-p.totalOut)}</div></div>
        <div className="kpi"><div className="label">Bottom line</div><div className="value"><Kes cents={p.closingBalance} /></div><div className="sub">on {formatDate(p.days.at(-1)!.date)}</div></div>
        <div className="kpi"><div className="label">Lowest balance</div><div className="value"><Kes cents={p.lowestBalance} /></div><div className="sub">on {formatDate(p.lowestDate)}</div></div>
      </div>
      <div className="grid-2">
        <section className="card">
          <h2>Balance, next {p.horizon} days</h2>
          <BalanceChart projection={p} />
        </section>
        <section className="card">
          <h2>Accounts <button className="btn sm" onClick={() => a.openAccount()}>+ Add</button></h2>
          <ul className="list">
            {accounts.map((acc) => (
              <li key={acc.id} className="clickable" onClick={() => a.openAccount(acc)}>
                <div className="grow"><div className="title">{acc.name}</div>
                  <div className="meta">{acc.includeInTotal ? "Counted in cash today" : "Not counted (e.g. savings)"}{acc.details ? ` · ${acc.details}` : ""}</div></div>
                <Kes cents={acc.balance} />
              </li>
            ))}
            {!accounts.length && <li className="muted">No accounts yet.</li>}
          </ul>
          <div className="total-row"><span>Cash today</span><Kes cents={p.openingBalance} /></div>
        </section>
      </div>
      <section className="card">
        <h2>Coming up <button className="btn sm" onClick={() => a.goto("daily")}>See all days</button></h2>
        {upcoming.length ? (
          <ul className="list">
            {upcoming.map((r) => (
              <li key={`${r.date}-${r.item.id}`} className="clickable" onClick={() => a.openItem(r.item)}>
                <div className="grow"><div className="title">{r.item.name}</div><div className="meta">{formatDate(r.date)}{r.date === p.today ? " · today" : ""}</div></div>
                <Kes cents={r.amt} sign />
              </li>
            ))}
          </ul>
        ) : <div className="empty">Nothing scheduled. <button className="btn sm" onClick={() => a.openItem()}>Add an item</button></div>}
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Items

export function Items({ data, a }: { data: BudgetPayload; a: ViewActions }) {
  const { items, accounts, projection } = data;
  const [q, setQ] = useState("");
  const [showDone, setShowDone] = useState(true);
  const acct = Object.fromEntries(accounts.map((x) => [x.id, x.name]));
  const names = Object.fromEntries(items.map((x) => [x.id, x.name]));
  const query = q.trim().toLowerCase();
  const shown = items.filter((i) => (showDone || !i.done) && (!query || i.name.toLowerCase().includes(query) || i.note.toLowerCase().includes(query)));
  const pendingIn = items.filter((i) => !i.done && i.amount > 0).reduce((s, i) => s + i.amount, 0);
  const pendingOut = items.filter((i) => !i.done && i.amount < 0).reduce((s, i) => s + i.amount, 0);
  return (
    <>
      <div className="toolbar">
        <input type="search" placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
        <label className="check small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show paid</label>
        <button className="btn primary" onClick={() => a.openItem()}>+ Add item</button>
      </div>
      <p className="small muted">Pending per occurrence: in <b className="pos">{formatKes(pendingIn)}</b> · out <b className="neg">{formatKes(-pendingOut)}</b>. Tick an item when it&apos;s paid. It stops counting.</p>
      {shown.map((i) => (
        <div key={i.id} className={`item ${i.done ? "done" : ""}`}>
          <button className="tick" onClick={() => a.toggleDone(i)} aria-label={i.done ? "Mark as not paid" : "Mark as paid"} title={i.done ? "Paid. Tap to undo" : "Mark as paid"}>✓</button>
          <div className="body" onClick={() => a.openItem(i)}>
            <div className="title">{i.name}</div>
            <div className="meta">
              <span>{schedule(i, projection.effectiveDates[i.id])}</span>
              {i.accountId && acct[i.accountId] && <span className="chip">{acct[i.accountId]}</span>}
              {i.tieTo && names[i.tieTo] && <span className="chip tie">waits for {names[i.tieTo]}</span>}
              {i.note && <span>{i.note}</span>}
            </div>
          </div>
          <div className="amt"><Kes cents={i.amount} sign /></div>
        </div>
      ))}
      {!shown.length && <div className="empty">{items.length ? "No items match." : "No items yet. Add your income and bills to see your cash flow."}</div>}
    </>
  );
}

// ---------------------------------------------------------------- Daily grid

export function Daily({ data }: { data: BudgetPayload }) {
  const { projection: p, items } = data;
  const [open, setOpen] = useState<string | null>(null);
  const cols = items.filter((i) => p.days.some((d) => d.flows[i.id]));
  const names = Object.fromEntries(items.map((i) => [i.id, i.name]));
  return (
    <>
      <div className="toolbar">
        <div className="small muted">Opening cash <b><Kes cents={p.openingBalance} /></b> · tap a day for details</div>
        <div className="spacer" />
        <a className="btn sm" href={`/api/budgets/${data.budget.id}/export`}>⬇ Export CSV</a>
        <button className="btn sm" onClick={() => window.print()}>Print</button>
      </div>
      <div className="table-wrap">
        <table className="daygrid">
          <thead>
            <tr>
              <th className="l sticky">Date</th>
              {cols.map((i) => <th key={i.id} className="item-col wide-only" title={i.name}>{i.name}</th>)}
              <th>Day&apos;s net flow</th><th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {p.days.map((d) => {
              const flows = Object.entries(d.flows).filter(([, v]) => v);
              return [
                <tr key={d.date} className={`clickable ${d.date === p.today ? "today" : ""} ${[0, 6].includes(weekday(d.date)) ? "weekend" : ""} ${d.balance < 0 ? "negative" : ""}`}
                  onClick={() => setOpen(open === d.date ? null : d.date)}>
                  <td className="l sticky">{formatDate(d.date)}</td>
                  {cols.map((i) => { const v = d.flows[i.id]; return <td key={i.id} className={`num wide-only ${v ? tone(v) : "muted"}`}>{v ? formatPlain(v) : ""}</td>; })}
                  <td className={`num net ${tone(d.net)}`}>{d.net ? formatKes(d.net, { sign: true }) : "—"}</td>
                  <td className="num bal">{formatKes(d.balance)}</td>
                </tr>,
                open === d.date && (
                  <tr key={`${d.date}-detail`} className="detail"><td colSpan={cols.length + 3}>
                    {flows.length ? flows.map(([id, v]) => <div key={id} className="flow-line"><span>{names[id]}</span><Kes cents={v} sign /></div>) : <span className="muted">No money moves this day.</span>}
                  </td></tr>
                ),
              ];
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="l sticky"><b>Total</b></td>
              {cols.map((i) => { const s = p.days.reduce((t, d) => t + (d.flows[i.id] ?? 0), 0); return <td key={i.id} className={`num wide-only ${tone(s)}`}><b>{formatPlain(s)}</b></td>; })}
              <td><b><Kes cents={p.netFlow} sign /></b></td>
              <td><b><Kes cents={p.closingBalance} /></b></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

