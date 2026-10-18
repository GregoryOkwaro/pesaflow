"use client";

import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import type { BudgetPayload, Me, Payment, Plan } from "./types";
import { longDate } from "./ui";

export function Settings({ data, me, budgetsCount, plans, onBudgetSaved, onCopy, onNew, onDelete, onBilling, onMe, onLogout, toast }: {
  data: BudgetPayload; me: Me; budgetsCount: number; plans: Plan[];
  onBudgetSaved: (d: BudgetPayload) => void; onCopy: () => void; onNew: () => void; onDelete: () => void;
  onBilling: () => void; onMe: (u: Me) => void; onLogout: () => void; toast: (m: string) => void;
}) {
  const [history, setHistory] = useState<Payment[] | null>(null);
  const planLabel = (k: string) => plans.find((p) => p.key === k)?.label ?? k;
  const run = (fn: () => Promise<void>) => fn().catch((e: Error) => e.message && toast(e.message));
  const fields = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); return Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>; };

  return (
    <>
      <section className="card">
        <h2>This budget</h2>
        <form onSubmit={(e) => { const f = fields(e); run(async () => {
          onBudgetSaved(await api<BudgetPayload>("PUT", `/api/budgets/${data.budget.id}`, { name: f.name, horizonDays: Number(f.horizonDays) }));
          toast("Budget saved");
        }); }}>
          <label className="field"><span>Name</span><input name="name" type="text" defaultValue={data.budget.name} required maxLength={80} /></label>
          <label className="field"><span>Days to project</span><input name="horizonDays" type="number" min={7} max={120} defaultValue={data.budget.horizonDays} />
            <div className="hint">The original spreadsheet looks 31 days ahead.</div></label>
          <button className="btn primary" type="submit">Save</button>
        </form>
      </section>

      <section className="card">
        <h2>Budgets</h2>
        <p className="small muted">Start next month&apos;s budget as a copy of this one, or a blank one.</p>
        <div className="toolbar">
          <button className="btn" onClick={onCopy}>Copy this budget</button>
          <button className="btn" onClick={onNew}>New blank budget</button>
          <div className="spacer" />
          <button className="btn danger" onClick={onDelete} disabled={budgetsCount <= 1}>Delete this budget</button>
        </div>
      </section>

      <section className="card">
        <h2>Subscription</h2>
        <p>{me.subscription.active
          ? <>Access until <b>{longDate(me.subscription.accessUntil)}</b>{me.subscription.onTrial ? " (free trial)" : ""}.</>
          : <><span className="neg">Expired.</span> Your data is safe but read-only.</>}</p>
        <div className="toolbar">
          <button className="btn primary" onClick={onBilling}>Pay with M-Pesa</button>
          <button className="btn" onClick={() => run(async () => setHistory((await api<{ payments: Payment[] }>("GET", "/api/billing/payments")).payments))}>Payment history</button>
        </div>
        {history && (history.length ? (
          <ul className="list">
            {history.map((p) => (
              <li key={p.id}>
                <div className="grow"><div className="title">{planLabel(p.plan)} · KES {p.amount.toLocaleString("en-KE")}</div>
                  <div className="meta">{p.createdAt.slice(0, 16).replace("T", " ")} · {p.phone}{p.receipt ? ` · ${p.receipt}` : ""}{p.status === "failed" && p.resultDesc ? ` · ${p.resultDesc}` : ""}</div></div>
                <span className={`chip ${p.status === "success" ? "" : "tie"}`}>{p.status}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted small">No payments yet.</p>)}
      </section>

      <section className="card">
        <h2>Your profile</h2>
        <form onSubmit={(e) => { const f = fields(e); run(async () => { onMe((await api<{ user: Me }>("PUT", "/api/me", f)).user); toast("Profile saved"); }); }}>
          <div className="row2">
            <label className="field"><span>Name</span><input name="name" type="text" defaultValue={me.name} required /></label>
            <label className="field"><span>M-Pesa number</span><input name="phone" type="tel" defaultValue={me.phoneDisplay} placeholder="07XX XXX XXX" /></label>
          </div>
          <p className="small muted">Signed in as {me.email}</p>
          <button className="btn" type="submit">Save profile</button>
        </form>
      </section>

      <section className="card">
        <h2>Change password</h2>
        <form onSubmit={(e) => { const form = e.currentTarget; const f = fields(e); run(async () => {
          await api("POST", "/api/me/password", { current: f.current, next: f.next });
          form.reset();
          toast("Password changed. Other devices were signed out.");
        }); }}>
          <div className="row2">
            <label className="field"><span>Current password</span><input name="current" type="password" autoComplete="current-password" required /></label>
            <label className="field"><span>New password</span><input name="next" type="password" autoComplete="new-password" minLength={8} required /></label>
          </div>
          <button className="btn" type="submit">Change password</button>
        </form>
      </section>

      <div className="toolbar"><div className="spacer" /><button className="btn danger" onClick={onLogout}>Log out</button></div>
    </>
  );
}
