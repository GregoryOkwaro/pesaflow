import type { Projection } from "@/engine/engine";

export interface Account {
  id: string; budgetId: string; name: string; details: string; balance: number; includeInTotal: boolean; sort: number;
}
export interface Item {
  id: string; budgetId: string; name: string; amount: number; everyDays: number; valueDate: string | null;
  endDate: string | null; tieTo: string | null; done: boolean; accountId: string | null; note: string; sort: number;
}
export interface BudgetPayload {
  budget: { id: string; name: string; horizonDays: number; currency: string };
  accounts: Account[];
  items: Item[];
  projection: Projection;
}
export interface BudgetSummary { id: string; name: string; horizonDays: number; currency: string }
export interface Subscription { active: boolean; onTrial: boolean; accessUntil: string; daysLeft: number; card: string | null }
export interface Me {
  id: string; name: string; email: string; phone: string; phoneDisplay: string; isAdmin: boolean;
  country: string; timezone: string; locale: string; defaultCurrency: string;
  subscription: Subscription;
  card: { status: string | null; manageUrl: string | null; cancelUrl: string | null } | null;
}
/** Prices in minor units: `kes` for M-Pesa, `usd` for display elsewhere (Paddle shows the real local price). */
export interface Plan { key: "monthly" | "quarterly" | "yearly"; days: number; kes: number; usd: number; paddlePriceId: string | null }
export interface PaymentConfig { mpesaEnv: string; paddleEnv: string; paddleClientToken: string | null; cardEnabled: boolean }
/** Prices and payment options for the user's country (see src/server/pricing.ts). */
export interface Pricing {
  country: string; localCurrency: string; chargedInLocal: boolean; methods: string[];
  plans: (Plan & { approxLocal: number | null })[];
}
export interface Payment {
  id: string; provider: string; plan: string; amount: number; currency: string; phone: string;
  status: "pending" | "success" | "failed"; resultDesc: string; receipt: string; createdAt: string;
}

export type Tab = "overview" | "items" | "daily" | "settings";
