import type { Projection } from "@/engine/engine";

export interface Account {
  id: string; budgetId: string; name: string; details: string; balance: number; includeInTotal: boolean; sort: number;
}
export interface Item {
  id: string; budgetId: string; name: string; amount: number; everyDays: number; valueDate: string | null;
  endDate: string | null; tieTo: string | null; done: boolean; accountId: string | null; note: string; sort: number;
}
export interface BudgetPayload {
  budget: { id: string; name: string; horizonDays: number };
  accounts: Account[];
  items: Item[];
  projection: Projection;
}
export interface BudgetSummary { id: string; name: string; horizonDays: number }
export interface Subscription { active: boolean; onTrial: boolean; accessUntil: string; daysLeft: number }
export interface Me { id: string; name: string; email: string; phone: string; phoneDisplay: string; isAdmin: boolean; subscription: Subscription }
export interface Plan { key: string; label: string; days: number; amount: number }
export interface Payment { id: string; plan: string; amount: number; phone: string; status: "pending" | "success" | "failed"; resultDesc: string; receipt: string; createdAt: string }

export type Tab = "overview" | "items" | "daily" | "settings";
