import { and, desc, eq, sql } from "drizzle-orm";
import { addDays, todayInNairobi } from "@/lib/dates";
import { db, schema } from "../db";
import { dummyPasswordHash, hashPassword, hashResetCode, newResetCode, verifyPassword, verifyResetCode } from "../auth/crypto";
import { createSession, type User } from "../auth/session";
import { env, isAdminEmail } from "../env";
import { ApiError } from "../http";
import { queueMessage } from "../jobs/queue";
import { displayPhone, normalizeKenyanPhone } from "../payments/phone";
import { subscriptionStatus } from "./billing";
import { seedBudget } from "./budgets";

export function userJson(u: User) {
  return {
    id: u.id, name: u.name, email: u.email, phone: u.phone ?? "", phoneDisplay: displayPhone(u.phone),
    isAdmin: u.isAdmin, subscription: subscriptionStatus(u),
  };
}

function phoneOrThrow(raw: string | undefined): string | null {
  if (!raw) return null;
  const p = normalizeKenyanPhone(raw);
  if (!p) throw new ApiError(400, "Enter a valid M-Pesa number, e.g. 0712 345 678.");
  return p;
}

export async function signup(input: { name: string; email: string; password: string; phone?: string }) {
  const phone = phoneOrThrow(input.phone);
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, input.email)).limit(1);
    if (existing.length) throw new ApiError(409, "An account with that email already exists. Log in instead.");
    const [user] = await tx.insert(schema.users).values({
      email: input.email, name: input.name, phone, passwordHash, isAdmin: isAdminEmail(input.email),
      trialEndsAt: addDays(todayInNairobi(), env().TRIAL_DAYS - 1),
    }).returning();
    await seedBudget(tx, user!.id);
    const session = await createSession(user!.id, tx);
    return { user: user!, session };
  });
}

export async function login(email: string, password: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  // Verify against a dummy hash for unknown emails so response time doesn't reveal which emails exist.
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyPasswordHash()));
  if (!user || !ok) throw new ApiError(401, "Wrong email or password.");
  return { user, session: await createSession(user.id) };
}

export async function updateProfile(user: User, input: { name?: string; phone?: string }) {
  const [u] = await db.update(schema.users).set({
    name: input.name ?? user.name,
    phone: input.phone === undefined ? user.phone : phoneOrThrow(input.phone),
  }).where(eq(schema.users.id, user.id)).returning();
  return u!;
}

export async function changePassword(user: User, current: string, next: string) {
  if (!(await verifyPassword(current, user.passwordHash))) throw new ApiError(400, "Current password is wrong.");
  const passwordHash = await hashPassword(next);
  return db.transaction(async (tx) => {
    await tx.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, user.id));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
    return createSession(user.id, tx);
  });
}

// ---------------------------------------------------------------- password reset

export const RESET_SENT_MESSAGE = "If that email has an account, we've sent a 6-digit code to it (and by SMS to its phone number, if saved).";
const RESET_INVALID = "That code is wrong or has expired. Request a new one.";

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
  await queueMessage({
    kind: "reset_code", email: user.email, name: user.name, phone: user.phone,
    subject: `${app} password reset code`,
    text: `Hi ${user.name}, your ${app} reset code is ${code}. It expires in ${env().RESET_CODE_MINUTES} minutes. If you didn't ask for this, ignore this message.`,
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
