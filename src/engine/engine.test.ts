/**
 * The engine must reproduce the original workbook's numbers.
 * Fixture: the GFSN workbook as calculated on 16 Oct 2026, item names anonymised.
 * Expected values are the workbook's cached AW (day's net flow) and AX (balance) columns.
 */
import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import { effectiveDate, project, type EngineAccount, type EngineItem } from "./engine";

const TODAY = "2026-10-16";
const X = (serial: number) => addDays("1899-12-30", serial); // Excel serial -> ISO date

const ACCOUNTS: EngineAccount[] = [
  { id: "M", balance: -165200, includeInTotal: true },
  { id: "E", balance: 926700, includeInTotal: true },
  { id: "O", balance: 2267700, includeInTotal: true },
];

// [row, amount KES, every days, value date serial, end date serial, tie_to row]
const ROWS: [number, number, number, number | null, number | null, number | null][] = [
  [36, 35000, 0, 46313, null, null], [37, 0, 0, 46300, null, null], [38, -500, 2, 46313, null, null],
  [39, -1750, 3, 46311, null, null], [40, 0, 0, 46300, null, null], [41, 0, 0, 46311, null, null],
  [42, 0, 0, 46300, null, null], [43, 0, 0, null, null, null], [44, -5000, 2, 46308, 46314, null],
  [45, 0, 0, 46294, null, null], [46, 0, 0, 46301, null, null], [47, 0, 0, 46297, null, null],
  [48, 0, 0, 46311, null, null], [49, 0, 0, 46301, null, null], [50, -90000, 0, 46313, null, null],
  [51, 0, 0, 46300, null, null], [52, 0, 0, 46297, null, null], [53, 0, 0, 46280, null, null],
  [54, 0, 0, 46280, null, null], [55, 0, 0, 46290, null, null], [56, 0, 0, 46277, null, null],
  [57, 0, 0, 46315, null, 36], [58, 0, 0, null, null, null], [59, 0, 0, 46300, null, null],
  [60, 0, 0, 46311, null, null],
];

const EXPECTED_NET = [-6750, 0, -60500, -1750, -500, 0, -2250, 0, -500, -1750, -500, 0, -2250, 0, -500, -1750,
  -500, 0, -2250, 0, -500, -1750, -500, 0, -2250, 0, -500, -1750, -500, 0, -2250];
const EXPECTED_BAL = [23542, 23542, -36958, -38708, -39208, -39208, -41458, -41458, -41958, -43708, -44208,
  -44208, -46458, -46458, -46958, -48708, -49208, -49208, -51458, -51458, -51958, -53708, -54208, -54208,
  -56458, -56458, -56958, -58708, -59208, -59208, -61458];

const item = (p: Partial<EngineItem> & { id: string }): EngineItem => ({
  amount: 0, everyDays: 0, valueDate: null, endDate: null, tieTo: null, done: false, accountId: null, ...p,
});

const workbookItems = () => ROWS.map(([row, kes, every, vd, ed, tie]) => item({
  id: String(row), amount: kes * 100, everyDays: every, valueDate: vd ? X(vd) : null,
  endDate: ed ? X(ed) : null, tieTo: tie ? String(tie) : null,
}));

describe("workbook parity", () => {
  it("matches the spreadsheet day by day", () => {
    const p = project(ACCOUNTS, workbookItems(), TODAY, 31);
    expect(X(46311)).toBe(TODAY);
    expect(p.openingBalance).toBe(3029200);
    expect(p.days.map((d) => d.net / 100)).toEqual(EXPECTED_NET);
    expect(p.days.map((d) => d.balance / 100)).toEqual(EXPECTED_BAL);
    expect(p.closingBalance).toBe(-6145800);
    expect(p.firstNegativeDate).toBe(X(46313));
  });
});

describe("rules", () => {
  const T = TODAY;
  it("done items contribute nothing", () => {
    expect(project([], [item({ id: "a", amount: -100, valueDate: T, done: true })], T, 5).closingBalance).toBe(0);
  });
  it("overdue and blank dates fall due today", () => {
    const m = new Map<string, EngineItem>();
    expect(effectiveDate(item({ id: "a", valueDate: addDays(T, -9) }), T, m)).toBe(T);
    expect(effectiveDate(item({ id: "b" }), T, m)).toBe(T);
  });
  it("a tied debit waits for its credit, but never moves earlier", () => {
    const credit = item({ id: "c", amount: 1000, valueDate: addDays(T, 5) });
    const early = item({ id: "d", amount: -500, valueDate: addDays(T, 1), tieTo: "c" });
    const late = item({ id: "e", amount: -500, valueDate: addDays(T, 9), tieTo: "c" });
    const m = new Map([credit, early, late].map((i) => [i.id, i]));
    expect(effectiveDate(early, T, m)).toBe(credit.valueDate);
    expect(effectiveDate(late, T, m)).toBe(late.valueDate);
  });
  it("end date stops recurrence", () => {
    const p = project([], [item({ id: "a", amount: -100, everyDays: 1, valueDate: T, endDate: addDays(T, 2) })], T, 10);
    expect(p.totalOut).toBe(-300);
  });
  it("excluded accounts are not cash today", () => {
    const p = project([{ id: "c", balance: 500, includeInTotal: true }, { id: "s", balance: 9999, includeInTotal: false }], [], T, 3);
    expect(p.openingBalance).toBe(500);
  });
  it("long horizons keep recurring", () => {
    expect(project([], [item({ id: "a", amount: -1, everyDays: 1, valueDate: T })], T, 90).totalOut).toBe(-90);
  });
});
