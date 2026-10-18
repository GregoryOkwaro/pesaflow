"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { api, onApiError } from "@/lib/api";
import { AccountDialog, BillingDialog, ItemDialog, NewBudgetDialog } from "./Dialogs";
import { Settings } from "./Settings";
import type { Account, BudgetPayload, BudgetSummary, Item, Me, PaymentConfig, Plan, Pricing, Tab } from "./types";
import { Confirm } from "./ui";
import { Daily, Items, Overview, SubscriptionBanner } from "./Views";

type Dialog =
  | { kind: "item"; item?: Item }
  | { kind: "account"; account?: Account }
  | { kind: "billing"; reason?: string; resume?: { id: string; cancelled: boolean } }
  | { kind: "newBudget"; copy: boolean }
  | { kind: "confirm"; message: string; okLabel: string; onOk: () => void }
  | null;

const TAB_ICONS: Record<Tab, string> = { overview: "▦", items: "☰", daily: "▤", settings: "⚙" };

export function BudgetApp(props: { me: Me; plans: Plan[]; payments: PaymentConfig; pricing: Pricing; budgets: BudgetSummary[]; initial: BudgetPayload }) {
  const { t, tp, locale } = useT();
  const router = useRouter();
  const search = useSearchParams();
  const [me, setMe] = useState(props.me);
  const [budgets, setBudgets] = useState(props.budgets);
  const [data, setData] = useState(props.initial);
  const [tab, setTab] = useState<Tab>((search.get("tab") as Tab) || "overview");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toastMsg, setToastMsg] = useState("");
  // Settings lists (countries, time zones, currencies) come from the browser's Intl data,
  // which can differ from the server's, so that tab renders only after hydration.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 2600);
  }, []);

  useEffect(() => {
    if (search.get("reset") === "1") toast(t("settings.passwordChanged"));
    // Back from the mobile money checkout (Flutterwave appends status/tx_ref/transaction_id;
    // we only trust our own server's check, but a cancel means there's nothing to wait for).
    const momo = search.get("momo");
    if (momo) {
      setDialog({ kind: "billing", resume: { id: momo, cancelled: search.get("status") === "cancelled" } });
      window.history.replaceState(null, "", "/app");
    }
    return onApiError((status, body) => {
      if (status === 401) router.replace("/login");
      if (status === 402) setDialog({ kind: "billing", reason: String(body.error ?? "") });
    });
  }, [router, search, toast, t]);

  // Re-sync after router.refresh() (e.g. a language change re-renders the page on the server).
  useEffect(() => setData(props.initial), [props.initial]);

  const switchTab = (next: Tab) => {
    setTab(next);
    window.history.replaceState(null, "", next === "overview" ? "/app" : `/app?tab=${next}`);
    window.scrollTo({ top: 0 });
  };

  const rememberBudget = (id: string) => { document.cookie = `pf_budget=${id}; path=/; max-age=31536000; samesite=lax`; };

  const refreshBudgets = async (selectId?: string) => {
    const { budgets: list } = await api<{ budgets: BudgetSummary[] }>("GET", "/api/budgets");
    setBudgets(list);
    const id = selectId && list.some((b) => b.id === selectId) ? selectId : list[0]!.id;
    setData(await api<BudgetPayload>("GET", `/api/budgets/${id}`));
    rememberBudget(id);
  };

  const loadBudget = async (id: string) => {
    setData(await api<BudgetPayload>("GET", `/api/budgets/${id}`));
    rememberBudget(id);
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
    toggleDone: (i: Item) => mutate("PUT", `/api/items/${i.id}`, { done: !i.done }, i.done ? t("items.markedUnpaid") : t("items.markedPaid")),
    openBilling: (reason?: string) => setDialog({ kind: "billing", reason }),
    goto: (next: "daily") => switchTab(next),
  };

  const s = me.subscription;
  const badge = !s.active
    ? <button className="badge bad" onClick={() => actions.openBilling()}>{t("sub.expiredBadge")}</button>
    : <button className={`badge ${s.daysLeft <= (s.onTrial ? 3 : 5) ? "warn" : ""}`} onClick={() => actions.openBilling()}>
        {s.onTrial ? tp("sub.trialBadge", s.daysLeft) : tp("sub.activeBadge", s.daysLeft)}</button>;

  const nextMonth = new Date(); nextMonth.setMonth(nextMonth.getMonth() + 1);

  return (
    <>
      <header className="topbar">
        <div className="brand"><img src="/icon.svg" alt="" /><span>PesaFlow</span></div>
        <select className="budget-select" aria-label={t("budget.name")} value={data.budget.id} onChange={(e) => loadBudget(e.target.value)}>
          {budgets.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}
        </select>
        <div className="spacer" />
        {badge}
      </header>
      <nav className="nav" aria-label="Sections">
        {(Object.keys(TAB_ICONS) as Tab[]).map((k) => (
          <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => switchTab(k)}>
            <span className="ico" aria-hidden="true">{TAB_ICONS[k]}</span>{t(`nav.${k}`)}
          </button>
        ))}
      </nav>
      <main>
        {tab !== "settings" && <SubscriptionBanner me={me} onRenew={() => actions.openBilling()} />}
        {tab === "overview" && <Overview data={data} a={actions} />}
        {tab === "items" && <Items data={data} a={actions} />}
        {tab === "daily" && <Daily data={data} />}
        {tab === "settings" && hydrated && (
          <Settings
            key={locale}
            data={data} me={me} budgetsCount={budgets.length} toast={toast} onMe={setMe}
            onBudgetSaved={(d) => { setData(d); setBudgets((bs) => bs.map((b) => (b.id === d.budget.id ? { ...b, name: d.budget.name, currency: d.budget.currency } : b))); }}
            onCopy={() => setDialog({ kind: "newBudget", copy: true })}
            onNew={() => setDialog({ kind: "newBudget", copy: false })}
            onBilling={() => actions.openBilling()}
            onLocaleChanged={() => router.refresh()}
            onDelete={() => setDialog({
              kind: "confirm", okLabel: t("common.delete"), message: t("budget.confirmDelete", { name: data.budget.name }),
              onOk: async () => { await api("DELETE", `/api/budgets/${data.budget.id}`).catch((e: Error) => toast(e.message)); await refreshBudgets(); toast(t("budget.deleted")); },
            })}
            onLogout={async () => { await api("POST", "/api/auth/logout").catch(() => {}); router.replace("/login"); }}
          />
        )}
      </main>

      {dialog?.kind === "item" && (
        <ItemDialog data={data} item={dialog.item} onSaved={saved} onClose={() => setDialog(null)}
          onDelete={(i) => setDialog({ kind: "confirm", okLabel: t("common.delete"), message: t("itemDialog.confirmDelete", { name: i.name }), onOk: () => mutate("DELETE", `/api/items/${i.id}`, undefined, t("items.deleted")) })} />
      )}
      {dialog?.kind === "account" && (
        <AccountDialog budgetId={data.budget.id} currency={data.budget.currency} account={dialog.account} onSaved={saved} onClose={() => setDialog(null)}
          onDelete={(a) => setDialog({ kind: "confirm", okLabel: t("common.delete"), message: t("accountDialog.confirmDelete", { name: a.name }), onOk: () => mutate("DELETE", `/api/accounts/${a.id}`, undefined, t("accountDialog.deleted")) })} />
      )}
      {dialog?.kind === "billing" && (
        <BillingDialog me={me} plans={props.plans} pricing={props.pricing} config={props.payments} reason={dialog.reason} resume={dialog.resume} onUser={setMe} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "newBudget" && (
        <NewBudgetDialog
          copyFrom={dialog.copy ? data.budget.id : undefined}
          defaultCurrency={me.defaultCurrency}
          suggested={dialog.copy ? t("budget.copySuffix", { name: data.budget.name }) : nextMonth.toLocaleDateString(locale === "en" ? "en-GB" : locale, { month: "long", year: "numeric" })}
          onClose={() => setDialog(null)}
          onCreated={async (d) => { setDialog(null); await refreshBudgets(d.budget.id); switchTab("items"); toast(t("budget.created")); }}
        />
      )}
      {dialog?.kind === "confirm" && <Confirm message={dialog.message} okLabel={dialog.okLabel} onOk={dialog.onOk} onClose={() => setDialog(null)} />}

      <div id="toast" className={toastMsg ? "show" : ""} role="status" aria-live="polite">{toastMsg}</div>
    </>
  );
}
