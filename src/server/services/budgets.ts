/** Budgets, accounts and items. Every query is scoped to the owning user. */
import { and, asc, count, eq, max } from "drizzle-orm";
import type { z } from "zod";
import { addDays, todayIn } from "@/lib/dates";
import { currencyExponent, parseMoney, toDecimalString } from "@/lib/money";
import { project, type Projection } from "@/engine/engine";
import { translator, type Locale } from "@/i18n/translate";
import { db, schema, type DbOrTx } from "../db";
import { env } from "../env";
import { ApiError } from "../http";
import type { accountInput, itemInput } from "../validation";

type Budget = typeof schema.budgets.$inferSelect;
type Account = typeof schema.accounts.$inferSelect;
type Item = typeof schema.items.$inferSelect;
type AccountInput = z.infer<typeof accountInput>;
type ItemInput = z.infer<typeof itemInput>;

export interface BudgetPayload {
  budget: { id: string; name: string; horizonDays: number; currency: string };
  accounts: Account[];
  items: Item[];
  projection: Projection;
}

/** Decimal string from the request -> minor units of this budget's currency. */
function toMinor(value: string, currency: string): number {
  const minor = parseMoney(value, currency);
  if (minor === null) {
    const decimals = currencyExponent(currency);
    throw new ApiError(400, decimals < 3 && /\.\d+$/.test(value) ? "errors.amountDecimals" : "errors.amountInvalid", { currency, decimals });
  }
  return minor;
}

// Rough "how many units is a typical salary" so starter examples look sensible in any currency.
const EXAMPLE_SCALE: Record<string, number> = {
  KES: 1, UGX: 28, TZS: 20, RWF: 10, NGN: 12, GHS: 0.12, ZAR: 0.14, ETB: 0.9, XOF: 4.6, XAF: 4.6, EGP: 0.37, MAD: 0.077,
  INR: 0.65, PKR: 2.2, BDT: 0.9, IDR: 120, PHP: 0.43, VND: 190, JPY: 1.15, KRW: 10, CNY: 0.055, BRL: 0.042, MXN: 0.14,
  COP: 30, ARS: 7, CLP: 7.2, PEN: 0.029, TRY: 0.25, RUB: 0.7, UAH: 0.3, PLN: 0.03, HUF: 2.8, CZK: 0.18, SEK: 0.08, NOK: 0.08, DKK: 0.053,
};
const exampleAmount = (kesWhole: number, currency: string) => {
  // Default ≈ 1 USD/EUR/GBP per 130 KES; round to a "nice" number in that currency.
  const major = kesWhole * (EXAMPLE_SCALE[currency] ?? 1 / 130);
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, major))) - 1);
  return Math.round(major / mag) * mag * 10 ** currencyExponent(currency);
};

export async function seedBudget(tx: DbOrTx, userId: string, currency: string, locale: Locale) {
  const { t } = translator(locale);
  const [user] = await tx.select({ tz: schema.users.timezone }).from(schema.users).where(eq(schema.users.id, userId));
  const today = todayIn(user?.tz ?? "UTC");
  const [b] = await tx.insert(schema.budgets).values({ userId, name: t("seed.budget"), currency }).returning();
  const [wallet] = await tx.insert(schema.accounts).values([
    { budgetId: b!.id, name: currency === "KES" ? "M-Pesa" : t("seed.mobileMoney"), sort: 1 },
    { budgetId: b!.id, name: t("seed.bank"), sort: 2 },
  ]).returning();
  const [salary] = await tx.insert(schema.items).values({
    budgetId: b!.id, name: t("seed.salary"), amount: exampleAmount(50_000, currency), valueDate: addDays(today, 5),
    accountId: wallet!.id, note: t("seed.editMe"), sort: 1,
  }).returning();
  await tx.insert(schema.items).values([
    { budgetId: b!.id, name: t("seed.rent"), amount: -exampleAmount(20_000, currency), valueDate: today, tieTo: salary!.id, accountId: wallet!.id, note: t("seed.waitsSalary"), sort: 2 },
    { budgetId: b!.id, name: t("seed.food"), amount: -exampleAmount(500, currency), everyDays: 2, valueDate: today, accountId: wallet!.id, sort: 3 },
  ]);
  return b!;
}

export async function listBudgets(userId: string) {
  return db.select({ id: schema.budgets.id, name: schema.budgets.name, horizonDays: schema.budgets.horizonDays, currency: schema.budgets.currency })
    .from(schema.budgets).where(eq(schema.budgets.userId, userId)).orderBy(asc(schema.budgets.createdAt));
}

export async function ownBudget(userId: string, budgetId: string, tx: DbOrTx = db): Promise<Budget> {
  const [b] = await tx.select().from(schema.budgets).where(and(eq(schema.budgets.id, budgetId), eq(schema.budgets.userId, userId))).limit(1);
  if (!b) throw new ApiError(404, "errors.budgetNotFound");
  return b;
}

/** `today` is the user's own calendar date (their time zone), so "due today" means their today. */
export async function budgetPayload(userId: string, budgetId: string, today: string): Promise<BudgetPayload> {
  const b = await ownBudget(userId, budgetId);
  const [accounts, items] = await Promise.all([
    db.select().from(schema.accounts).where(eq(schema.accounts.budgetId, b.id)).orderBy(asc(schema.accounts.sort), asc(schema.accounts.id)),
    db.select().from(schema.items).where(eq(schema.items.budgetId, b.id)).orderBy(asc(schema.items.sort), asc(schema.items.id)),
  ]);
  const projection = project(
    accounts.map((a) => ({ id: a.id, balance: a.balance, includeInTotal: a.includeInTotal })),
    items.map((i) => ({ id: i.id, amount: i.amount, everyDays: i.everyDays, valueDate: i.valueDate, endDate: i.endDate, tieTo: i.tieTo, done: i.done, accountId: i.accountId })),
    today,
    b.horizonDays,
  );
  return { budget: { id: b.id, name: b.name, horizonDays: b.horizonDays, currency: b.currency }, accounts, items, projection };
}

export async function createBudget(userId: string, name: string, opts: { copyFrom?: string; currency: string }) {
  return db.transaction(async (tx) => {
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(schema.budgets).where(eq(schema.budgets.userId, userId));
    if (n >= env().MAX_BUDGETS_PER_USER) throw new ApiError(400, "errors.maxBudgets", { max: env().MAX_BUDGETS_PER_USER });
    const src = opts.copyFrom ? await ownBudget(userId, opts.copyFrom, tx) : null;
    const [b] = await tx.insert(schema.budgets).values({
      userId, name, horizonDays: src?.horizonDays ?? 31, currency: src?.currency ?? opts.currency,
    }).returning();
    if (!src) {
      await tx.insert(schema.accounts).values({ budgetId: b!.id, name: opts.currency === "KES" ? "M-Pesa" : "Cash", sort: 1 });
      return b!;
    }
    const accountMap = new Map<string, string>();
    for (const a of await tx.select().from(schema.accounts).where(eq(schema.accounts.budgetId, src.id))) {
      const [na] = await tx.insert(schema.accounts).values({ budgetId: b!.id, name: a.name, details: a.details, balance: a.balance, includeInTotal: a.includeInTotal, sort: a.sort }).returning();
      accountMap.set(a.id, na!.id);
    }
    const srcItems = await tx.select().from(schema.items).where(eq(schema.items.budgetId, src.id));
    const itemMap = new Map<string, string>();
    for (const i of srcItems) {
      const [ni] = await tx.insert(schema.items).values({
        budgetId: b!.id, name: i.name, amount: i.amount, everyDays: i.everyDays, valueDate: i.valueDate, endDate: i.endDate,
        done: i.done, note: i.note, sort: i.sort, accountId: i.accountId ? accountMap.get(i.accountId) ?? null : null,
      }).returning();
      itemMap.set(i.id, ni!.id);
    }
    for (const i of srcItems) {
      if (i.tieTo && itemMap.has(i.tieTo)) {
        await tx.update(schema.items).set({ tieTo: itemMap.get(i.tieTo)! }).where(eq(schema.items.id, itemMap.get(i.id)!));
      }
    }
    return b!;
  });
}

/**
 * Changing currency relabels the budget. Amounts keep their *value in major units*
 * (100.50 stays 100.50), so they're rescaled when the decimal places differ (e.g. KES -> JPY).
 */
export async function updateBudget(userId: string, budgetId: string, input: { name?: string; horizonDays?: number; currency?: string }) {
  const b = await ownBudget(userId, budgetId);
  await db.transaction(async (tx) => {
    await tx.update(schema.budgets).set({
      name: input.name ?? b.name, horizonDays: input.horizonDays ?? b.horizonDays, currency: input.currency ?? b.currency,
    }).where(eq(schema.budgets.id, b.id));
    if (input.currency && input.currency !== b.currency) {
      const shift = currencyExponent(input.currency) - currencyExponent(b.currency);
      if (shift !== 0) {
        const rescale = (v: number) => (shift > 0 ? v * 10 ** shift : Math.round(v / 10 ** -shift));
        for (const a of await tx.select().from(schema.accounts).where(eq(schema.accounts.budgetId, b.id))) {
          await tx.update(schema.accounts).set({ balance: rescale(a.balance) }).where(eq(schema.accounts.id, a.id));
        }
        for (const i of await tx.select().from(schema.items).where(eq(schema.items.budgetId, b.id))) {
          await tx.update(schema.items).set({ amount: rescale(i.amount) }).where(eq(schema.items.id, i.id));
        }
      }
    }
  });
}

export async function deleteBudget(userId: string, budgetId: string) {
  const b = await ownBudget(userId, budgetId);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(schema.budgets).where(eq(schema.budgets.userId, userId));
  if (n <= 1) throw new ApiError(400, "errors.lastBudget");
  await db.delete(schema.budgets).where(eq(schema.budgets.id, b.id));
}

// ---------------------------------------------------------------- accounts

async function ownAccount(userId: string, id: string): Promise<Account & { currency: string }> {
  const [row] = await db.select({ a: schema.accounts, currency: schema.budgets.currency }).from(schema.accounts)
    .innerJoin(schema.budgets, eq(schema.budgets.id, schema.accounts.budgetId))
    .where(and(eq(schema.accounts.id, id), eq(schema.budgets.userId, userId))).limit(1);
  if (!row) throw new ApiError(404, "errors.notFound");
  return { ...row.a, currency: row.currency };
}

async function ownItem(userId: string, id: string): Promise<Item & { currency: string }> {
  const [row] = await db.select({ i: schema.items, currency: schema.budgets.currency }).from(schema.items)
    .innerJoin(schema.budgets, eq(schema.budgets.id, schema.items.budgetId))
    .where(and(eq(schema.items.id, id), eq(schema.budgets.userId, userId))).limit(1);
  if (!row) throw new ApiError(404, "errors.notFound");
  return { ...row.i, currency: row.currency };
}

const MAX_ACCOUNTS = 20;

export async function createAccount(userId: string, budgetId: string, input: AccountInput) {
  const b = await ownBudget(userId, budgetId);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(schema.accounts).where(eq(schema.accounts.budgetId, b.id));
  if (n >= MAX_ACCOUNTS) throw new ApiError(400, "errors.maxAccounts", { max: MAX_ACCOUNTS });
  await db.insert(schema.accounts).values({ ...input, balance: toMinor(input.balance, b.currency), budgetId: b.id });
  return b.id;
}

export async function updateAccount(userId: string, accountId: string, input: Partial<AccountInput>) {
  const a = await ownAccount(userId, accountId);
  const { balance, ...rest } = input;
  await db.update(schema.accounts).set({ ...rest, ...(balance !== undefined ? { balance: toMinor(balance, a.currency) } : {}) })
    .where(eq(schema.accounts.id, a.id));
  return a.budgetId;
}

export async function deleteAccount(userId: string, accountId: string) {
  const a = await ownAccount(userId, accountId);
  await db.delete(schema.accounts).where(eq(schema.accounts.id, a.id));
  return a.budgetId;
}

// ---------------------------------------------------------------- items

async function checkRefs(budgetId: string, input: Partial<ItemInput>, selfId?: string) {
  if (input.tieTo) {
    if (input.tieTo === selfId) throw new ApiError(400, "errors.tieSelf");
    const [t] = await db.select({ id: schema.items.id }).from(schema.items).where(and(eq(schema.items.id, input.tieTo), eq(schema.items.budgetId, budgetId)));
    if (!t) throw new ApiError(400, "errors.tieNotFound");
  }
  if (input.accountId) {
    const [a] = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(and(eq(schema.accounts.id, input.accountId), eq(schema.accounts.budgetId, budgetId)));
    if (!a) throw new ApiError(400, "errors.accountNotFound");
  }
}

function checkDates(valueDate: string | null | undefined, endDate: string | null | undefined) {
  if (valueDate && endDate && endDate < valueDate) throw new ApiError(400, "errors.endBeforeStart");
}

export async function createItem(userId: string, budgetId: string, input: ItemInput) {
  const b = await ownBudget(userId, budgetId);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(schema.items).where(eq(schema.items.budgetId, b.id));
  if (n >= env().MAX_ITEMS_PER_BUDGET) throw new ApiError(400, "errors.maxItems", { max: env().MAX_ITEMS_PER_BUDGET });
  await checkRefs(b.id, input);
  checkDates(input.valueDate, input.endDate);
  const [{ m } = { m: 0 }] = await db.select({ m: max(schema.items.sort) }).from(schema.items).where(eq(schema.items.budgetId, b.id));
  await db.insert(schema.items).values({ ...input, amount: toMinor(input.amount, b.currency), sort: input.sort ?? (m ?? 0) + 1, budgetId: b.id });
  return b.id;
}

export async function updateItem(userId: string, itemId: string, input: Partial<ItemInput>) {
  const i = await ownItem(userId, itemId);
  await checkRefs(i.budgetId, input, i.id);
  checkDates(input.valueDate !== undefined ? input.valueDate : i.valueDate, input.endDate !== undefined ? input.endDate : i.endDate);
  const { amount, ...rest } = input;
  await db.update(schema.items).set({ ...rest, ...(amount !== undefined ? { amount: toMinor(amount, i.currency) } : {}) })
    .where(eq(schema.items.id, i.id));
  return i.budgetId;
}

export async function deleteItem(userId: string, itemId: string) {
  const i = await ownItem(userId, itemId);
  await db.delete(schema.items).where(eq(schema.items.id, i.id));
  return i.budgetId;
}

/** CSV in the spreadsheet's layout: one column per item, then day's net flow and balance. */
export function toCsv(p: BudgetPayload, locale: Locale): string {
  const { t } = translator(locale);
  const cur = p.budget.currency;
  const esc = (v: string) => (/[",\n]/.test(v) || /^[=+\-@]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v); // also defuses formula injection
  const num = (minor: number) => toDecimalString(minor, cur);
  const header = [t("daily.date"), ...p.items.map((i) => i.name), `${t("daily.net")} (${cur})`, `${t("daily.csvBalance")} (${cur})`].map(esc);
  const rows = p.projection.days.map((d) => [d.date, ...p.items.map((i) => (d.flows[i.id] !== undefined ? num(d.flows[i.id]!) : "")), num(d.net), num(d.balance)]);
  return "﻿" + [header, ...rows].map((r) => r.join(",")).join("\r\n");
}
