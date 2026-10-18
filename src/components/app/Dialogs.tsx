"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiClientError } from "@/lib/api";
import { formatPlain } from "@/lib/money";
import type { Account, BudgetPayload, Item, Me, Payment, Plan } from "./types";
import { FormError, longDate, Modal } from "./ui";

const errMsg = (e: unknown) => (e instanceof ApiClientError && e.status === 402 ? "" : (e as Error).message);

// ---------------------------------------------------------------- item

const PRESETS: [string, string][] = [["0", "Once"], ["1", "Daily"], ["7", "Weekly"], ["14", "Every 2 weeks"], ["30", "Monthly (30 days)"]];

export function ItemDialog({ data, item, onSaved, onDelete, onClose }: {
  data: BudgetPayload; item?: Item; onSaved: (d: BudgetPayload, msg: string) => void; onDelete: (item: Item) => void; onClose: () => void;
}) {
  const isNew = !item;
  const [dir, setDir] = useState<"in" | "out">(item && item.amount > 0 ? "in" : "out");
  const [every, setEvery] = useState(String(item?.everyDays ?? 0));
  const [preset, setPreset] = useState(PRESETS.some(([v]) => v === String(item?.everyDays ?? 0)) ? String(item?.everyDays ?? 0) : "custom");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const others = data.items.filter((i) => i.id !== item?.id);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const raw = (f.amount ?? "").replace(/[,\s]/g, "");
    if (raw && !/^\d*\.?\d{0,2}$/.test(raw)) return setError("Enter the amount as a number, e.g. 2500.");
    const everyDays = Number(every) || 0;
    const body = {
      name: f.name,
      amount: raw ? (dir === "out" ? "-" : "") + raw : 0,
      valueDate: f.valueDate || null,
      everyDays,
      endDate: everyDays > 0 ? f.endDate || null : null,
      accountId: f.accountId || null,
      tieTo: f.tieTo || null,
      note: f.note ?? "",
      done: f.done === "on",
    };
    setBusy(true);
    try {
      const d = await api<BudgetPayload>(isNew ? "POST" : "PUT", isNew ? `/api/budgets/${data.budget.id}/items` : `/api/items/${item!.id}`, body);
      onSaved(d, isNew ? "Item added" : "Item saved");
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={isNew ? "Add item" : "Edit item"} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <FormError message={error} />
        <label className="field"><span>What is it?</span><input name="name" type="text" defaultValue={item?.name} placeholder="e.g. Rent, Salary, School fees" required maxLength={120} /></label>
        <div className="field"><span className="small muted"><b>Money</b></span>
          <div className="toolbar">
            <div className="seg" role="group" aria-label="Direction">
              <button type="button" className={`out ${dir === "out" ? "on" : ""}`} onClick={() => setDir("out")}>− Money out</button>
              <button type="button" className={`in ${dir === "in" ? "on" : ""}`} onClick={() => setDir("in")}>+ Money in</button>
            </div>
          </div>
          <input name="amount" type="text" inputMode="decimal" aria-label="Amount in KES" placeholder="Amount in KES"
            defaultValue={item?.amount ? formatPlain(Math.abs(item.amount)).replace(/,/g, "") : ""} />
        </div>
        <div className="row2">
          <label className="field"><span>Date due</span><input name="valueDate" type="date" defaultValue={item ? item.valueDate ?? "" : data.projection.today} />
            <div className="hint">Past and blank dates count as due today.</div></label>
          <label className="field"><span>Repeats</span>
            <select value={preset} onChange={(e) => { setPreset(e.target.value); if (e.target.value !== "custom") setEvery(e.target.value); }}>
              {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              <option value="custom">Every N days…</option>
            </select></label>
        </div>
        <div className="row2">
          {preset === "custom" && <label className="field"><span>Every (days)</span><input type="number" min={0} max={366} value={every} onChange={(e) => setEvery(e.target.value)} /></label>}
          {Number(every) > 0 && <label className="field"><span>Stop after</span><input name="endDate" type="date" defaultValue={item?.endDate ?? ""} /><div className="hint">Optional end date.</div></label>}
        </div>
        <div className="row2">
          <label className="field"><span>Account</span>
            <select name="accountId" defaultValue={item ? item.accountId ?? "" : data.accounts[0]?.id ?? ""}>
              <option value="">—</option>
              {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></label>
          <label className="field"><span>Wait for income</span>
            <select name="tieTo" defaultValue={item?.tieTo ?? ""}>
              <option value="">— Not tied</option>
              {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <div className="hint">Pay this only once the chosen income arrives.</div></label>
        </div>
        <label className="field"><span>Note</span><textarea name="note" maxLength={500} defaultValue={item?.note} placeholder="Phone, paybill, account no…" /></label>
        <label className="check"><input type="checkbox" name="done" defaultChecked={item?.done} /> Already paid / received (stop counting it)</label>
        <div className="actions">
          <button className="btn primary" type="submit" disabled={busy}>{isNew ? "Add item" : "Save"}</button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <div className="spacer" />
          {!isNew && <button className="btn danger" type="button" onClick={() => onDelete(item!)}>Delete</button>}
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- account

export function AccountDialog({ budgetId, account, onSaved, onDelete, onClose }: {
  budgetId: string; account?: Account; onSaved: (d: BudgetPayload, msg: string) => void; onDelete: (a: Account) => void; onClose: () => void;
}) {
  const isNew = !account;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const raw = (f.balance ?? "").replace(/[,\s]/g, "");
    if (raw && !/^-?\d*\.?\d{0,2}$/.test(raw)) return setError("Enter the balance as a number, e.g. 12500 or -1652.");
    setBusy(true);
    try {
      const d = await api<BudgetPayload>(isNew ? "POST" : "PUT", isNew ? `/api/budgets/${budgetId}/accounts` : `/api/accounts/${account!.id}`,
        { name: f.name, balance: raw || 0, details: f.details ?? "", includeInTotal: f.includeInTotal === "on" });
      onSaved(d, "Account saved");
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }
  return (
    <Modal title={isNew ? "Add account" : "Edit account"} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <FormError message={error} />
        <label className="field"><span>Account name</span><input name="name" type="text" defaultValue={account?.name} placeholder="e.g. M-Pesa, Equity, KCB" required maxLength={60} /></label>
        <label className="field"><span>Balance right now (KES)</span>
          <input name="balance" type="text" inputMode="decimal" defaultValue={account ? String(account.balance / 100) : "0"} />
          <div className="hint">Use a minus sign for an overdraft or Fuliza, e.g. -1652.</div></label>
        <label className="field"><span>Details (optional)</span><input name="details" type="text" defaultValue={account?.details} maxLength={200} placeholder="Account no., paybill…" /></label>
        <label className="check"><input type="checkbox" name="includeInTotal" defaultChecked={account?.includeInTotal ?? true} /> Count this in my cash today</label>
        <p className="hint">Untick savings accounts. Money you put into savings is a budget expense, not cash you can spend.</p>
        <div className="actions">
          <button className="btn primary" type="submit" disabled={busy}>{isNew ? "Add account" : "Save"}</button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <div className="spacer" />
          {!isNew && <button className="btn danger" type="button" onClick={() => onDelete(account!)}>Delete</button>}
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- budget name

export function NewBudgetDialog({ copyFrom, suggested, onCreated, onClose }: {
  copyFrom?: string; suggested: string; onCreated: (d: BudgetPayload) => void; onClose: () => void;
}) {
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      onCreated(await api<BudgetPayload>("POST", "/api/budgets", { name: new FormData(e.currentTarget).get("name"), copyFrom }));
    } catch (err) {
      setError(errMsg(err));
    }
  }
  return (
    <Modal title={copyFrom ? "Copy budget" : "New budget"} onClose={onClose}>
      <form onSubmit={submit}>
        <FormError message={error} />
        <label className="field"><span>Name</span><input name="name" type="text" defaultValue={suggested} required maxLength={80} /></label>
        <div className="actions"><button className="btn primary" type="submit">Create</button><button className="btn" type="button" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- M-Pesa billing

export function BillingDialog({ me, plans, mpesaEnv, reason, onUser, onClose }: {
  me: Me; plans: Plan[]; mpesaEnv: string; reason?: string; onUser: (u: Me) => void; onClose: () => void;
}) {
  const [plan, setPlan] = useState(plans[0]?.key ?? "monthly");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<{ payment: Payment; message: string } | null>(null);
  const [result, setResult] = useState<{ payment: Payment; user: Me } | null>(null);
  const [slow, setSlow] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const s = me.subscription;

  useEffect(() => () => clearInterval(timer.current), []);

  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    timer.current = setInterval(async () => {
      try {
        const res = await api<{ payment: Payment; user: Me }>("GET", `/api/billing/payments/${waiting.payment.id}`);
        if (res.payment.status === "pending") {
          if (Date.now() - started > 150_000) { clearInterval(timer.current); setSlow(true); }
          return;
        }
        clearInterval(timer.current);
        onUser(res.user);
        setResult(res);
      } catch { /* transient: keep polling */ }
    }, 3000);
    return () => clearInterval(timer.current);
  }, [waiting, onUser]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setWaiting(await api<{ payment: Payment; message: string }>("POST", "/api/billing/subscribe", { plan, phone: new FormData(e.currentTarget).get("phone") }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  let content;
  if (result?.payment.status === "success") {
    content = (
      <div className="mpesa-wait">
        <div className="alert ok">✓ Payment received{result.payment.receipt ? ` · ${result.payment.receipt}` : ""}</div>
        <p>You&apos;re all set until <b>{longDate(result.user.subscription.accessUntil)}</b>. Thank you!</p>
        <button className="btn primary full" onClick={onClose}>Continue</button>
      </div>
    );
  } else if (result) {
    content = (
      <div className="mpesa-wait">
        <div className="alert bad">Payment didn&apos;t go through.</div>
        <p className="small muted">{result.payment.resultDesc || "The request was cancelled or timed out."}</p>
        <button className="btn primary full" onClick={() => { setResult(null); setWaiting(null); setBusy(false); }}>Try again</button>
      </div>
    );
  } else if (waiting) {
    content = (
      <div className="mpesa-wait">
        <div className="spinner" />
        <p><b>{waiting.message}</b></p>
        <p className="small muted">Sent to {waiting.payment.phone} · KES {waiting.payment.amount.toLocaleString("en-KE")}</p>
        <p className="small muted">{slow ? "Still waiting. If you paid, it will apply automatically. Check back shortly." : "Waiting for confirmation…"}</p>
      </div>
    );
  } else {
    content = (
      <>
        {reason && <div className="alert warn">{reason}</div>}
        <p className="small muted">{s.active ? `You have access until ${longDate(s.accessUntil)}. Paying now adds time on top.` : "Choose a plan to unlock editing again."}</p>
        <form onSubmit={submit} noValidate>
          <FormError message={error} />
          <div className="plans" role="radiogroup">
            {plans.map((p) => (
              <label key={p.key} className={`plan ${plan === p.key ? "on" : ""}`}>
                <input type="radio" name="plan" value={p.key} checked={plan === p.key} onChange={() => setPlan(p.key)} />
                <div><b>{p.label}</b><div className="small muted">{p.days} days{p.key === "yearly" ? " · best value" : ""}</div></div>
                <div className="price num">KES {p.amount.toLocaleString("en-KE")}</div>
              </label>
            ))}
          </div>
          <label className="field"><span>M-Pesa number</span><input name="phone" type="tel" inputMode="tel" defaultValue={me.phoneDisplay} placeholder="07XX XXX XXX" required /></label>
          <button className="btn primary full" type="submit" disabled={busy}>Send M-Pesa prompt</button>
          <p className="hint">You&apos;ll get a prompt on your phone. Enter your M-Pesa PIN to pay.
            {mpesaEnv === "mock" && <b> (Test mode: no real money is charged.)</b>}{mpesaEnv === "sandbox" && <b> (Sandbox mode.)</b>}</p>
        </form>
      </>
    );
  }
  return <Modal title="Pay with M-Pesa" onClose={onClose}>{content}</Modal>;
}
