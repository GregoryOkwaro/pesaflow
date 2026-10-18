/** Budgets, accounts and items. Every query is scoped to the owning user. */
import { and, asc, count, eq, max } from "drizzle-orm";
import { addDays, todayInNairobi } from "@/lib/dates";
import { project, type Projection } from "@/engine/engine";
import { db, schema, type DbOrTx } from "../db";
import { env } from "../env";
import { ApiError } from "../http";
import type { z } from "zod";
import type { accountInput, itemInput } from "../validation";

type Budget = typeof schema.budgets.$inferSelect;
type Account = typeof schema.accounts.$inferSelect;
type Item = typeof schema.items.$inferSelect;
type AccountInput = z.infer<typeof accountInput>;
type ItemInput = z.infer<typeof itemInput>;

export interface BudgetPayload {
  budget: { id: string; name: string; horizonDays: number };
  accounts: Account[];
  items: Item[];
  projection: Projection;
}

export async function seedBudget(tx: DbOrTx, userId: string) {
  const t = todayInNairobi();
  const [b] = await tx.insert(schema.budgets).values({ userId, name: "My monthly budget" }).returning();
  const [mpesa] = await tx.insert(schema.accounts).values([
    { budgetId: b!.id, name: "M-Pesa", sort: 1 },
    { budgetId: b!.id, name: "Bank", sort: 2 },
  ]).returning();
  const [salary] = await tx.insert(schema.items).values({
    budgetId: b!.id, name: "Salary (example)", amount: 5_000_000, valueDate: addDays(t, 5), accountId: mpesa!.id, note: "Edit or delete me", sort: 1,
  }).returning();
  await tx.insert(schema.items).values([
    { budgetId: b!.id, name: "Rent (example)", amount: -2_000_000, valueDate: t, tieTo: salary!.id, accountId: mpesa!.id, note: "Waits for salary", sort: 2 },
    { budgetId: b!.id, name: "Food & transport (example)", amount: -50_000, everyDays: 2, valueDate: t, accountId: mpesa!.id, sort: 3 },
  ]);
  return b!;
}

export async function listBudgets(userId: string) {
  return db.select({ id: schema.budgets.id, name: schema.budgets.name, horizonDays: schema.budgets.horizonDays })
    .from(schema.budgets).where(eq(schema.budgets.userId, userId)).orderBy(asc(schema.budgets.createdAt));
}

export async function ownBudget(userId: string, budgetId: string, tx: DbOrTx = db): Promise<Budget> {
  const [b] = await tx.select().from(schema.budgets).where(and(eq(schema.budgets.id, budgetId), eq(schema.budgets.userId, userId))).limit(1);
  if (!b) throw new ApiError(404, "Budget not found.");
  return b;
}

export async function budgetPayload(userId: string, budgetId: string): Promise<BudgetPayload> {
  const b = await ownBudget(userId, budgetId);
  const [accounts, items] = await Promise.all([
    db.select().from(schema.accounts).where(eq(schema.accounts.budgetId, b.id)).orderBy(asc(schema.accounts.sort), asc(schema.accounts.id)),
    db.select().from(schema.items).where(eq(schema.items.budgetId, b.id)).orderBy(asc(schema.items.sort), asc(schema.items.id)),
  ]);
  const projection = project(
    accounts.map((a) => ({ id: a.id, balance: a.balance, includeInTotal: a.includeInTotal })),
    items.map((i) => ({ id: i.id, amount: i.amount, everyDays: i.everyDays, valueDate: i.valueDate, endDate: i.endDate, tieTo: i.tieTo, done: i.done, accountId: i.accountId })),
    todayInNairobi(),
    b.horizonDays,
  );
  return { budget: { id: b.id, name: b.name, horizonDays: b.horizonDays }, accounts, items, projection };
}

export async function createBudget(userId: string, name: string, copyFrom?: string) {
  return db.transaction(async (tx) => {
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(schema.budgets).where(eq(schema.budgets.userId, userId));
    if (n >= env().MAX_BUDGETS_PER_USER) throw new ApiError(400, `You can have up to ${env().MAX_BUDGETS_PER_USER} budgets.`);
    const src = copyFrom ? await ownBudget(userId, copyFrom, tx) : null;
    const [b] = await tx.insert(schema.budgets).values({ userId, name, horizonDays: src?.horizonDays ?? 31 }).returning();
    if (!src) {
      await tx.insert(schema.accounts).values({ budgetId: b!.id, name: "M-Pesa", sort: 1 });
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

export async function updateBudget(userId: string, budgetId: string, input: { name?: string; horizonDays?: number }) {
  const b = await ownBudget(userId, budgetId);
  await db.update(schema.budgets).set({ name: input.name ?? b.name, horizonDays: input.horizonDays ?? b.horizonDays }).where(eq(schema.budgets.id, b.id));
}

export async function deleteBudget(userId: string, budgetId: string) {
  const b = await ownBudget(userId, budgetId);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(schema.budgets).where(eq(schema.budgets.userId, userId));
  if (n <= 1) throw new ApiError(400, "You need at least one budget.");
  await db.delete(schema.budgets).where(eq(schema.budgets.id, b.id));
}

// ---------------------------------------------------------------- accounts

async function ownAccount(userId: string, id: string): Promise<Account> {
  const [row] = await db.select({ a: schema.accounts }).from(schema.accounts)
    .innerJoin(schema.budgets, eq(schema.budgets.id, schema.accounts.budgetId))
    .where(and(eq(schema.accounts.id, id), eq(schema.budgets.userId, userId))).limit(1);
  if (!row) throw new ApiError(404, "Not found.");
  return row.a;
}

async function ownItem(userId: string, id: string): Promise<Item> {
  const [row] = await db.select({ i: schema.items }).from(schema.items)
    .innerJoin(schema.budgets, eq(schema.budgets.id, schema.items.budgetId))
    .where(and(eq(schema.items.id, id), eq(schema.budgets.userId, userId))).limit(1);
  if (!row) throw new ApiError(404, "Not found.");
  return row.i;
}

export async function createAccount(userId: string, budgetId: string, input: AccountInput) {
  const b = await ownBudget(userId, budgetId);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(schema.accounts).where(eq(schema.accounts.budgetId, b.id));
  if (n >= 20) throw new ApiError(400, "Up to 20 accounts per budget.");
  await db.insert(schema.accounts).values({ ...input, budgetId: b.id });
  return b.id;
}

export async function updateAccount(userId: string, accountId: string, input: Partial<AccountInput>) {
  const a = await ownAccount(userId, accountId);
  await db.update(schema.accounts).set(input).where(eq(schema.accounts.id, a.id));
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
    if (input.tieTo === selfId) throw new ApiError(400, "An item can't be tied to itself.");
    const [t] = await db.select({ id: schema.items.id }).from(schema.items).where(and(eq(schema.items.id, input.tieTo), eq(schema.items.budgetId, budgetId)));
    if (!t) throw new ApiError(400, "Tied item not found in this budget.");
  }
  if (input.accountId) {
    const [a] = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(and(eq(schema.accounts.id, input.accountId), eq(schema.accounts.budgetId, budgetId)));
    if (!a) throw new ApiError(400, "Account not found in this budget.");
  }
}

function checkDates(valueDate: string | null | undefined, endDate: string | null | undefined) {
  if (valueDate && endDate && endDate < valueDate) throw new ApiError(400, "End date can't be before the date due.");
}

export async function createItem(userId: string, budgetId: string, input: ItemInput) {
  const b = await ownBudget(userId, budgetId);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(schema.items).where(eq(schema.items.budgetId, b.id));
  if (n >= env().MAX_ITEMS_PER_BUDGET) throw new ApiError(400, `Up to ${env().MAX_ITEMS_PER_BUDGET} items per budget.`);
  await checkRefs(b.id, input);
  checkDates(input.valueDate, input.endDate);
  const [{ m } = { m: 0 }] = await db.select({ m: max(schema.items.sort) }).from(schema.items).where(eq(schema.items.budgetId, b.id));
  await db.insert(schema.items).values({ ...input, sort: input.sort ?? (m ?? 0) + 1, budgetId: b.id });
  return b.id;
}

export async function updateItem(userId: string, itemId: string, input: Partial<ItemInput>) {
  const i = await ownItem(userId, itemId);
  await checkRefs(i.budgetId, input, i.id);
  checkDates(input.valueDate !== undefined ? input.valueDate : i.valueDate, input.endDate !== undefined ? input.endDate : i.endDate);
  await db.update(schema.items).set(input).where(eq(schema.items.id, i.id));
  return i.budgetId;
}

export async function deleteItem(userId: string, itemId: string) {
  const i = await ownItem(userId, itemId);
  await db.delete(schema.items).where(eq(schema.items.id, i.id));
  return i.budgetId;
}

/** CSV in the spreadsheet's layout: one column per item, then day's net flow and balance. */
export function toCsv(p: BudgetPayload): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; // also defuses spreadsheet formula injection
  };
  const header = ["Date", ...p.items.map((i) => i.name), "Day's net flow", "Cumulative balance"];
  const rows = p.projection.days.map((d) => [d.date, ...p.items.map((i) => (d.flows[i.id] !== undefined ? d.flows[i.id]! / 100 : "")), d.net / 100, d.balance / 100]);
  return "﻿" + [header, ...rows].map((r) => r.map((v) => (typeof v === "number" ? String(v) : esc(v))).join(",")).join("\r\n");
}
