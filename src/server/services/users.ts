import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { currencyForCountry, isCountry } from "@/lib/countries";
import { addDays, isTimeZone, todayIn } from "@/lib/dates";
import { isLocale, translator, type Locale } from "@/i18n/translate";
import { db, schema } from "../db";
import { dummyPasswordHash, hashPassword, hashResetCode, newResetCode, verifyPassword, verifyResetCode } from "../auth/crypto";
import { createSession, type User } from "../auth/session";
import { env, isAdminEmail } from "../env";
import { ApiError } from "../http";
import { queueMessage } from "../jobs/queue";
import { cancelSubscriptionNow } from "../payments/paddle";
import { displayPhone, normalizePhone } from "../payments/phone";
import { paymentJson, subscriptionStatus } from "./billing";
import { seedBudget } from "./budgets";

export function userJson(u: User) {
  return {
    id: u.id, name: u.name, email: u.email, phone: u.phone ?? "", phoneDisplay: displayPhone(u.phone, u.country),
    isAdmin: u.isAdmin, country: u.country, timezone: u.timezone, locale: u.locale,
    defaultCurrency: currencyForCountry(u.country),
    subscription: subscriptionStatus(u),
    card: u.paddleSubscriptionId ? { status: u.paddleSubscriptionStatus, manageUrl: u.paddleManageUrl, cancelUrl: u.paddleCancelUrl } : null,
  };
}

function phoneOrThrow(raw: string | undefined, country: string): string | null {
  if (!raw) return null;
  const p = normalizePhone(raw, country);
  if (!p) throw new ApiError(400, "errors.phoneInvalid");
  return p;
}

export async function signup(input: {
  name: string; email: string; password: string; phone?: string;
  country?: string; timezone?: string; locale?: string;
}, hints: { country?: string | null; locale?: Locale } = {}) {
  const country = isCountry(input.country) ? input.country : isCountry(hints.country) ? hints.country! : "KE";
  const timezone = isTimeZone(input.timezone) ? input.timezone : "UTC";
  const locale = isLocale(input.locale) ? input.locale : hints.locale ?? "en";
  const phone = phoneOrThrow(input.phone, country);
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, input.email)).limit(1);
    if (existing.length) throw new ApiError(409, "errors.emailTaken");
    const [user] = await tx.insert(schema.users).values({
      email: input.email, name: input.name, phone, passwordHash, isAdmin: isAdminEmail(input.email),
      country, timezone, locale,
      trialEndsAt: addDays(todayIn(timezone), env().TRIAL_DAYS - 1),
    }).returning();
    await seedBudget(tx, user!.id, currencyForCountry(country), locale);
    const session = await createSession(user!.id, tx);
    return { user: user!, session };
  });
}

export async function login(email: string, password: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  // Verify against a dummy hash for unknown emails so response time doesn't reveal which emails exist.
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyPasswordHash()));
  if (!user || !ok) throw new ApiError(401, "errors.wrongLogin");
  return { user, session: await createSession(user.id) };
}

export async function updateProfile(user: User, input: { name?: string; phone?: string; country?: string; timezone?: string; locale?: string }) {
  const country = input.country ?? user.country;
  const [u] = await db.update(schema.users).set({
    name: input.name ?? user.name,
    phone: input.phone === undefined ? user.phone : phoneOrThrow(input.phone, country),
    country,
    timezone: input.timezone ?? user.timezone,
    locale: input.locale ?? user.locale,
  }).where(eq(schema.users.id, user.id)).returning();
  return u!;
}

export async function changePassword(user: User, current: string, next: string) {
  if (!(await verifyPassword(current, user.passwordHash))) throw new ApiError(400, "errors.wrongPassword");
  const passwordHash = await hashPassword(next);
  return db.transaction(async (tx) => {
    await tx.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, user.id));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
    return createSession(user.id, tx);
  });
}

// ---------------------------------------------------------------- GDPR: access & erasure

/** Everything we hold about a user, for "download my data" (GDPR Art. 15/20). */
export async function exportUserData(user: User) {
  const budgets = await db.select().from(schema.budgets).where(eq(schema.budgets.userId, user.id));
  const ids = budgets.map((b) => b.id);
  const [accounts, items, payments] = await Promise.all([
    ids.length ? db.select().from(schema.accounts).where(inArray(schema.accounts.budgetId, ids)) : [],
    ids.length ? db.select().from(schema.items).where(inArray(schema.items.budgetId, ids)) : [],
    db.select().from(schema.payments).where(eq(schema.payments.userId, user.id)),
  ]);
  const { passwordHash: _omit, ...profile } = user;
  return {
    exportedAt: new Date().toISOString(),
    note: "Amounts are in minor units (cents) of each budget's or payment's currency.",
    profile,
    budgets: budgets.map((b) => ({ ...b, accounts: accounts.filter((a) => a.budgetId === b.id), items: items.filter((i) => i.budgetId === b.id) })),
    payments: payments.map(paymentJson),
  };
}

/** Permanently deletes the account (GDPR Art. 17). Cancels any card subscription first. */
export async function deleteAccount(user: User, password: string) {
  if (!(await verifyPassword(password, user.passwordHash))) throw new ApiError(400, "errors.wrongPassword");
  if (user.paddleSubscriptionId && user.paddleSubscriptionStatus !== "canceled") {
    await cancelSubscriptionNow(user.paddleSubscriptionId);
  }
  // Budgets, accounts, items, sessions, resets and payments cascade.
  await db.delete(schema.users).where(eq(schema.users.id, user.id));
}

// ---------------------------------------------------------------- password reset

export const RESET_SENT_KEY = "auth.resetSent" as const;
const RESET_INVALID = "errors.resetInvalid" as const;

/** Always resolves the same way whether or not the account exists. */
export async function requestReset(email: string): Promise<void> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!user) return;
  const code = newResetCode();
  const { salt, hash } = hashResetCode(code);
  await db.transaction(async (tx) => {
    await tx.delete(schema.passwordResets).where(eq(schema.passwordResets.userId, user.id));
    await tx.insert(schema.passwordResets).values({
      userId: user.id, codeHash: hash, salt, expiresAt: new Date(Date.now() + env().RESET_CODE_MINUTES * 60_000),
    });
  });
  const app = env().APP_NAME;
  const { t } = translator(isLocale(user.locale) ? user.locale : "en");
  await queueMessage({
    kind: "reset_code", email: user.email, name: user.name, phone: user.phone,
    subject: t("notify.resetSubject", { app }),
    text: t("notify.resetBody", { name: user.name, app, code, minutes: env().RESET_CODE_MINUTES }),
  });
}

export async function confirmReset(email: string, code: string, newPassword: string) {
  const [row] = await db.select({ r: schema.passwordResets, userId: schema.users.id })
    .from(schema.passwordResets).innerJoin(schema.users, eq(schema.users.id, schema.passwordResets.userId))
    .where(eq(schema.users.email, email)).orderBy(desc(schema.passwordResets.createdAt)).limit(1);
  if (!row || row.r.expiresAt <= new Date() || row.r.attempts >= env().RESET_MAX_ATTEMPTS) throw new ApiError(400, RESET_INVALID);
  if (!verifyResetCode(code, row.r.salt, row.r.codeHash)) {
    await db.update(schema.passwordResets).set({ attempts: sql`${schema.passwordResets.attempts} + 1` }).where(eq(schema.passwordResets.id, row.r.id));
    throw new ApiError(400, RESET_INVALID);
  }
  const passwordHash = await hashPassword(newPassword);
  return db.transaction(async (tx) => {
    // Delete-by-id guards against the same code being used twice concurrently.
    const used = await tx.delete(schema.passwordResets)
      .where(and(eq(schema.passwordResets.id, row.r.id), eq(schema.passwordResets.userId, row.userId))).returning();
    if (!used.length) throw new ApiError(400, RESET_INVALID);
    await tx.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, row.userId));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, row.userId));
    const session = await createSession(row.userId, tx);
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, row.userId));
    return { user: user!, session };
  });
}
