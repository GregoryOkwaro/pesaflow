"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, onApiError } from "@/lib/api";
import { AccountDialog, BillingDialog, ItemDialog, NewBudgetDialog } from "./Dialogs";
import { Settings } from "./Settings";
import type { Account, BudgetPayload, BudgetSummary, Item, Me, Plan, Tab } from "./types";
import { Confirm } from "./ui";
import { Daily, Items, Overview, SubscriptionBanner } from "./Views";

type Dialog =
  | { kind: "item"; item?: Item }
  | { kind: "account"; account?: Account }
  | { kind: "billing"; reason?: string }
  | { kind: "newBudget"; copy: boolean }
  | { kind: "confirm"; message: string; okLabel: string; onOk: () => void }
  | null;

const TABS: [Tab, string, string][] = [["overview", "▦", "Overview"], ["items", "☰", "Items"], ["daily", "▤", "Daily"], ["settings", "⚙", "Settings"]];

export function BudgetApp(props: { me: Me; plans: Plan[]; mpesaEnv: string; budgets: BudgetSummary[]; initial: BudgetPayload }) {
  const router = useRouter();
  const search = useSearchParams();
  const [me, setMe] = useState(props.me);
  const [budgets, setBudgets] = useState(props.budgets);
  const [data, setData] = useState(props.initial);
  const [tab, setTab] = useState<Tab>((search.get("tab") as Tab) || "overview");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 2600);
  }, []);

  useEffect(() => {
    if (search.get("reset") === "1") toast("Password changed. You're logged in.");
    return onApiError((status, body) => {
      if (status === 401) router.replace("/login");
      if (status === 402) setDialog({ kind: "billing", reason: String(body.error ?? "") });
    });
  }, [router, search, toast]);

  const switchTab = (t: Tab) => {
    setTab(t);
    window.history.replaceState(null, "", t === "overview" ? "/app" : `/app?tab=${t}`);
    window.scrollTo({ top: 0 });
  };

  const refreshBudgets = async (selectId?: string) => {
    const { budgets: list } = await api<{ budgets: BudgetSummary[] }>("GET", "/api/budgets");
    setBudgets(list);
    const id = selectId && list.some((b) => b.id === selectId) ? selectId : list[0]!.id;
    if (id !== data.budget.id || selectId) setData(await api<BudgetPayload>("GET", `/api/budgets/${id}`));
    document.cookie = `pf_budget=${id}; path=/; max-age=31536000; samesite=lax`;
  };

  const loadBudget = async (id: string) => {
    setData(await api<BudgetPayload>("GET", `/api/budgets/${id}`));
    document.cookie = `pf_budget=${id}; path=/; max-age=31536000; samesite=lax`;
  };

  const saved = (d: BudgetPayload, msg: string) => { setData(d); setDialog(null); toast(msg); };

  const mutate = async (method: string, path: string, body: unknown, msg: string) => {
    try {
      setData(await api<BudgetPayload>(method, path, body));
      toast(msg);
    } catch (e) {
      if ((e as { status?: number }).status !== 402) toast((e as Error).message);
    }
  };

  const actions = {
    openItem: (item?: Item) => setDialog({ kind: "item", item }),
    openAccount: (account?: Account) => setDialog({ kind: "account", account }),
    toggleDone: (i: Item) => mutate("PUT", `/api/items/${i.id}`, { done: !i.done }, i.done ? "Marked as not paid" : "Marked as paid"),
    openBilling: (reason?: string) => setDialog({ kind: "billing", reason }),
    goto: (t: "daily") => switchTab(t),
  };

  const s = me.subscription;
  const badge = !s.active
    ? <button className="badge bad" onClick={() => actions.openBilling()}>Expired · Renew</button>
    : <button className={`badge ${s.daysLeft <= (s.onTrial ? 3 : 5) ? "warn" : ""}`} onClick={() => actions.openBilling()}>
        {s.onTrial ? `Trial · ${s.daysLeft}d left` : `Active · ${s.daysLeft}d`}</button>;

  const nextMonth = new Date(); nextMonth.setMonth(nextMonth.getMonth() + 1);

  return (
    <>
      <header className="topbar">
        <div className="brand"><img src="/icon.svg" alt="" /><span>PesaFlow</span></div>
        <select className="budget-select" aria-label="Budget" value={data.budget.id} onChange={(e) => loadBudget(e.target.value)}>
          {budgets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <div className="spacer" />
        {badge}
      </header>
      <nav className="nav" aria-label="Sections">
        {TABS.map(([k, ico, label]) => (
          <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => switchTab(k)}>
            <span className="ico" aria-hidden="true">{ico}</span>{label}
          </button>
        ))}
      </nav>
      <main>
        {tab !== "settings" && <SubscriptionBanner me={me} onRenew={() => actions.openBilling()} />}
        {tab === "overview" && <Overview data={data} a={actions} />}
        {tab === "items" && <Items data={data} a={actions} />}
        {tab === "daily" && <Daily data={data} />}
        {tab === "settings" && (
          <Settings
            data={data} me={me} budgetsCount={budgets.length} plans={props.plans} toast={toast} onMe={setMe}
            onBudgetSaved={(d) => { setData(d); setBudgets((bs) => bs.map((b) => (b.id === d.budget.id ? { ...b, name: d.budget.name } : b))); }}
            onCopy={() => setDialog({ kind: "newBudget", copy: true })}
            onNew={() => setDialog({ kind: "newBudget", copy: false })}
            onBilling={() => actions.openBilling()}
            onDelete={() => setDialog({
              kind: "confirm", okLabel: "Delete", message: `Delete “${data.budget.name}” and all its items? This can't be undone.`,
              onOk: async () => { await api("DELETE", `/api/budgets/${data.budget.id}`).catch((e: Error) => toast(e.message)); await refreshBudgets(); toast("Budget deleted"); },
            })}
            onLogout={async () => { await api("POST", "/api/auth/logout").catch(() => {}); router.replace("/login"); }}
          />
        )}
      </main>

      {dialog?.kind === "item" && (
        <ItemDialog data={data} item={dialog.item} onSaved={saved} onClose={() => setDialog(null)}
          onDelete={(i) => setDialog({ kind: "confirm", okLabel: "Delete", message: `Delete “${i.name}”?`, onOk: () => mutate("DELETE", `/api/items/${i.id}`, undefined, "Item deleted") })} />
      )}
      {dialog?.kind === "account" && (
        <AccountDialog budgetId={data.budget.id} account={dialog.account} onSaved={saved} onClose={() => setDialog(null)}
          onDelete={(a) => setDialog({ kind: "confirm", okLabel: "Delete", message: `Delete account “${a.name}”? Items using it are kept.`, onOk: () => mutate("DELETE", `/api/accounts/${a.id}`, undefined, "Account deleted") })} />
      )}
      {dialog?.kind === "billing" && (
        <BillingDialog me={me} plans={props.plans} mpesaEnv={props.mpesaEnv} reason={dialog.reason} onUser={setMe} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "newBudget" && (
        <NewBudgetDialog
          copyFrom={dialog.copy ? data.budget.id : undefined}
          suggested={dialog.copy ? `${data.budget.name} (copy)` : nextMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
          onClose={() => setDialog(null)}
          onCreated={async (d) => { setDialog(null); await refreshBudgets(d.budget.id); switchTab("items"); toast("Budget created"); }}
        />
      )}
      {dialog?.kind === "confirm" && <Confirm message={dialog.message} okLabel={dialog.okLabel} onOk={dialog.onOk} onClose={() => setDialog(null)} />}

      <div id="toast" className={toastMsg ? "show" : ""} role="status" aria-live="polite">{toastMsg}</div>
    </>
  );
}
