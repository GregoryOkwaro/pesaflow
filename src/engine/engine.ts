/**
 * Cash-flow projection engine — a faithful port of the GFSN monthly cash flow
 * budget workbook (Sheet1). Pure functions: no I/O, safe to run on the server
 * or in the browser.
 *
 * - Opening balance  = sum of accounts counted in "cash today"   (=B34+D34+F34)
 * - Effective amount = 0 once an item is marked done             (N: =IF(K="Y",0,C))
 * - Effective date   = column O: overdue/blank -> today; a debit tied to a credit
 *                      never lands before that credit (per the cell comment).
 * - Occurrences      = effective date, then every N days until END DATE (rows 2–33).
 * - Each day         = sum of that day's occurrences (AW), running balance (AX).
 *
 * All money is integer minor units (cents) of the budget currency.
 */
import { addDays, diffDays, type ISODate } from "@/lib/dates";
import type { Minor as Cents } from "@/lib/money";

export interface EngineAccount {
  id: string;
  balance: Cents;
  includeInTotal: boolean;
}

export interface EngineItem {
  id: string;
  amount: Cents; // +inflow / -outflow
  everyDays: number; // 0 = one-off
  valueDate: ISODate | null;
  endDate: ISODate | null;
  tieTo: string | null; // id of the credit item this debit waits for
  done: boolean;
  accountId: string | null;
}

export interface DayRow {
  date: ISODate;
  flows: Record<string, Cents>; // item id -> amount
  net: Cents;
  balance: Cents;
}

export interface Projection {
  today: ISODate;
  horizon: number;
  openingBalance: Cents;
  closingBalance: Cents;
  totalIn: Cents;
  totalOut: Cents;
  netFlow: Cents;
  lowestBalance: Cents;
  lowestDate: ISODate;
  firstNegativeDate: ISODate | null;
  effectiveDates: Record<string, ISODate>;
  days: DayRow[];
}

export function effectiveAmount(item: EngineItem): Cents {
  return item.done ? 0 : item.amount;
}

export function effectiveDate(item: EngineItem, today: ISODate, byId: Map<string, EngineItem>): ISODate {
  const own = item.valueDate;
  if (item.done) return own === null || own > today ? today : own;
  let base = own;
  const tied = item.tieTo ? byId.get(item.tieTo) : undefined;
  if (tied?.valueDate) base = base === null || tied.valueDate > base ? tied.valueDate : base;
  return base === null || base < today ? today : base;
}

export function project(accounts: EngineAccount[], items: EngineItem[], today: ISODate, horizon = 31): Projection {
  const h = Math.max(1, Math.floor(horizon));
  const last = addDays(today, h - 1);
  const byId = new Map(items.map((i) => [i.id, i]));
  const days: DayRow[] = Array.from({ length: h }, (_, n) => ({ date: addDays(today, n), flows: {}, net: 0, balance: 0 }));
  const effectiveDates: Record<string, ISODate> = {};
  const openingBalance = accounts.reduce((s, a) => (a.includeInTotal ? s + a.balance : s), 0);

  let totalIn = 0;
  let totalOut = 0;
  for (const item of items) {
    const start = effectiveDate(item, today, byId);
    effectiveDates[item.id] = start;
    const amount = effectiveAmount(item);
    const stop = item.endDate && item.endDate < last ? item.endDate : last;
    for (let d = start; d <= stop; d = addDays(d, item.everyDays)) {
      const row = days[diffDays(d, today)];
      if (row) {
        row.flows[item.id] = amount;
        row.net += amount;
        if (amount > 0) totalIn += amount;
        else totalOut += amount;
      }
      if (item.everyDays <= 0) break;
    }
  }

  let balance = openingBalance;
  let lowestBalance = Number.POSITIVE_INFINITY;
  let lowestDate = today;
  let firstNegativeDate: ISODate | null = null;
  for (const row of days) {
    balance += row.net;
    row.balance = balance;
    if (balance < lowestBalance) {
      lowestBalance = balance;
      lowestDate = row.date;
    }
    if (balance < 0 && firstNegativeDate === null) firstNegativeDate = row.date;
  }

  return {
    today,
    horizon: h,
    openingBalance,
    closingBalance: balance,
    totalIn,
    totalOut,
    netFlow: totalIn + totalOut,
    lowestBalance,
    lowestDate,
    firstNegativeDate,
    effectiveDates,
    days,
  };
}
