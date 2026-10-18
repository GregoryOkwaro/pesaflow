/**
 * PostgreSQL 18 schema. IDs use Postgres 18's built-in uuidv7(): time-ordered
 * (index friendly) and safe to expose in URLs. Money is bigint *minor units* of
 * the row's currency (cents for KES/USD, whole yen for JPY, fils for KWD).
 * Calendar dates are `date` strings (YYYY-MM-DD) in the user's own time zone.
 */
import { sql } from "drizzle-orm";
import {
  bigint, boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull(), // stored lower-case
  name: text("name").notNull(),
  phone: text("phone"), // E.164 digits without "+", e.g. 254712345678
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  country: text("country").notNull().default("KE"), // ISO 3166-1 alpha-2
  timezone: text("timezone").notNull().default("Africa/Nairobi"), // IANA
  locale: text("locale").notNull().default("en"), // UI language
  trialEndsAt: date("trial_ends_at").notNull(),
  paidUntil: date("paid_until"),
  reminderSentFor: date("reminder_sent_for"), // access end date we last reminded about
  // Card subscriptions (Paddle). M-Pesa plans are prepaid and need no stored state.
  paddleCustomerId: text("paddle_customer_id"),
  paddleSubscriptionId: text("paddle_subscription_id"),
  paddleSubscriptionStatus: text("paddle_subscription_status"),
  paddleManageUrl: text("paddle_manage_url"),
  paddleCancelUrl: text("paddle_cancel_url"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("users_email_key").on(t.email), index("users_paddle_sub_idx").on(t.paddleSubscriptionId)]);

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const passwordResets = pgTable("password_resets", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  salt: text("salt").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [index("password_resets_user_idx").on(t.userId)]);

export const budgets = pgTable("budgets", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  horizonDays: integer("horizon_days").notNull().default(31),
  currency: text("currency").notNull().default("KES"), // ISO 4217; every amount in this budget
  createdAt: createdAt(),
}, (t) => [index("budgets_user_idx").on(t.userId)]);

export const accounts = pgTable("accounts", {
  id: id(),
  budgetId: uuid("budget_id").notNull().references(() => budgets.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  details: text("details").notNull().default(""),
  balance: bigint("balance", { mode: "number" }).notNull().default(0),
  includeInTotal: boolean("include_in_total").notNull().default(true),
  sort: integer("sort").notNull().default(0),
}, (t) => [index("accounts_budget_idx").on(t.budgetId)]);

export const items = pgTable("items", {
  id: id(),
  budgetId: uuid("budget_id").notNull().references(() => budgets.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  amount: bigint("amount", { mode: "number" }).notNull().default(0),
  everyDays: integer("every_days").notNull().default(0),
  valueDate: date("value_date"),
  endDate: date("end_date"),
  tieTo: uuid("tie_to").references((): AnyPgColumn => items.id, { onDelete: "set null" }),
  done: boolean("done").notNull().default(false),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  note: text("note").notNull().default(""),
  sort: integer("sort").notNull().default(0),
}, (t) => [index("items_budget_idx").on(t.budgetId)]);

export const payments = pgTable("payments", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // "mpesa" | "paddle" (Airtel/others later)
  plan: text("plan").notNull(),
  amount: bigint("amount", { mode: "number" }).notNull(), // minor units of `currency`
  currency: text("currency").notNull().default("KES"),
  phone: text("phone"), // M-Pesa only
  providerRef: text("provider_ref"), // Daraja CheckoutRequestID / Paddle transaction id
  merchantRef: text("merchant_ref"),
  status: text("status", { enum: ["pending", "success", "failed"] }).notNull().default("pending"),
  resultCode: text("result_code"),
  resultDesc: text("result_desc"),
  receipt: text("receipt"),
  applied: boolean("applied").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("payments_user_idx").on(t.userId),
  uniqueIndex("payments_provider_ref_key").on(t.provider, t.providerRef),
  uniqueIndex("payments_receipt_key").on(t.provider, t.receipt),
  index("payments_pending_idx").on(t.status, t.createdAt),
]);

/** Fixed-window rate limiting shared by every app instance. */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});
