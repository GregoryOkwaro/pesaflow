/**
 * Subscriptions paid through M-Pesa. New accounts get a free trial; afterwards
 * the account is read-only until paid. Each successful payment extends access
 * by the plan's days from whichever is later: yesterday, the trial end or the
 * current paid-until, so paying early never loses days.
 */
import { and, desc, eq, lt } from "drizzle-orm";
import { addDays, diffDays, formatDate, todayInNairobi, type ISODate } from "@/lib/dates";
import { db, schema } from "../db";
import { env, PLANS, type PlanKey } from "../env";
import { ApiError } from "../http";
import { queueMessage } from "../jobs/queue";
import { mpesaProvider, PaymentError, type PaymentProvider } from "../payments";
import { normalizeKenyanPhone } from "../payments/phone";

type User = typeof schema.users.$inferSelect;
type Payment = typeof schema.payments.$inferSelect;

export function accessUntil(user: Pick<User, "trialEndsAt" | "paidUntil">): ISODate {
  return user.paidUntil && user.paidUntil > user.trialEndsAt ? user.paidUntil : user.trialEndsAt;
}

export function subscriptionStatus(user: Pick<User, "trialEndsAt" | "paidUntil">, today: ISODate = todayInNairobi()) {
  const until = accessUntil(user);
  const active = until >= today;
  const paid = !!user.paidUntil && user.paidUntil >= today;
  return { active, onTrial: active && !paid, accessUntil: until, daysLeft: active ? diffDays(until, today) + 1 : 0 };
}

export function paymentJson(p: Payment) {
  return {
    id: p.id, plan: p.plan, amount: p.amount, phone: p.phone, status: p.status,
    resultDesc: p.resultDesc ?? "", receipt: p.receipt ?? "", createdAt: p.createdAt.toISOString(),
  };
}

export async function startPayment(user: User, planKey: string, rawPhone: string, provider: PaymentProvider = mpesaProvider()) {
  if (!(planKey in PLANS)) throw new ApiError(400, "Unknown plan.");
  const plan = PLANS[planKey as PlanKey];
  const phone = normalizeKenyanPhone(rawPhone);
  if (!phone) throw new ApiError(400, "Enter a valid M-Pesa number, e.g. 0712 345 678.");
  const amount = plan.amount();
  const [p] = await db.insert(schema.payments).values({ userId: user.id, provider: provider.name, plan: planKey, amount, phone }).returning();
  try {
    const res = await provider.startPayment({ phone, amount, reference: `PF${user.id.slice(-8)}`, description: `${plan.label} plan` });
    const [updated] = await db.update(schema.payments)
      .set({ providerRef: res.providerRef, merchantRef: res.merchantRef, updatedAt: new Date() })
      .where(eq(schema.payments.id, p!.id)).returning();
    return { payment: updated!, message: "Check your phone and enter your M-Pesa PIN to complete payment." };
  } catch (e) {
    const msg = e instanceof PaymentError ? e.message : "Could not start the M-Pesa payment.";
    await db.update(schema.payments).set({ status: "failed", resultDesc: msg, updatedAt: new Date() }).where(eq(schema.payments.id, p!.id));
    if (!(e instanceof PaymentError)) console.error(e);
    throw new ApiError(502, msg);
  }
}

/**
 * Moves a pending payment to success/failed exactly once, and on success
 * extends the subscription in the same transaction (row locks prevent a
 * callback and a status query from both applying it).
 */
export async function settle(paymentId: string, outcome: { success: boolean; code: string; description: string; receipt?: string }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(schema.payments).where(eq(schema.payments.id, paymentId)).for("update");
    if (!p || p.status !== "pending") return false;
    let { success, description } = outcome;
    if (success && outcome.receipt) {
      const dup = await tx.select({ id: schema.payments.id }).from(schema.payments)
        .where(and(eq(schema.payments.provider, p.provider), eq(schema.payments.receipt, outcome.receipt))).limit(1);
      if (dup.length) [success, description] = [false, "Duplicate receipt"];
    }
    await tx.update(schema.payments).set({
      status: success ? "success" : "failed",
      resultCode: outcome.code,
      resultDesc: description,
      receipt: success ? outcome.receipt ?? null : null,
      applied: success,
      updatedAt: new Date(),
    }).where(eq(schema.payments.id, p.id));
    if (!success) return true;

    const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, p.userId)).for("update");
    const from = [addDays(todayInNairobi(), -1), accessUntil(user!)].sort().at(-1)!;
    const plan = PLANS[p.plan as PlanKey];
    await tx.update(schema.users).set({ paidUntil: addDays(from, plan.days), reminderSentFor: null }).where(eq(schema.users.id, user!.id));
    return true;
  }).then(async (changed) => {
    if (changed && outcome.success) await sendReceipt(paymentId);
    return changed;
  });
}

async function sendReceipt(paymentId: string) {
  const [row] = await db.select({ p: schema.payments, u: schema.users }).from(schema.payments)
    .innerJoin(schema.users, eq(schema.users.id, schema.payments.userId)).where(eq(schema.payments.id, paymentId));
  if (!row || row.p.status !== "success") return;
  const until = accessUntil(row.u);
  await queueMessage({
    kind: "payment_receipt", email: row.u.email, name: row.u.name, phone: null,
    subject: `${env().APP_NAME} payment received`,
    text: `Hi ${row.u.name}, we received KES ${row.p.amount} for the ${PLANS[row.p.plan as PlanKey].label} plan` +
      `${row.p.receipt ? ` (M-Pesa ${row.p.receipt})` : ""}. You have access until ${formatDate(until, { day: "numeric", month: "long", year: "numeric" })}. Thank you!`,
  });
}

/** Daraja callback. Only touches a pending payment we created; checks the amount actually paid. */
export async function handleCallback(payload: unknown, provider: PaymentProvider = mpesaProvider()): Promise<void> {
  const cb = provider.parseCallback(payload);
  if (!cb) return;
  const [p] = await db.select().from(schema.payments)
    .where(and(eq(schema.payments.provider, provider.name), eq(schema.payments.providerRef, cb.providerRef))).limit(1);
  if (!p || p.status !== "pending") return;
  let { success, description } = cb;
  if (success && (cb.amount ?? 0) < p.amount) {
    success = false;
    description = `Amount mismatch: paid ${cb.amount ?? 0}, expected ${p.amount}. Receipt ${cb.receipt ?? "-"} needs manual review.`;
  }
  await settle(p.id, { success, code: cb.code, description, receipt: success ? cb.receipt : undefined });
}

/** Fallback when the callback is late or lost: ask the provider directly. */
export async function refresh(p: Payment, provider: PaymentProvider = mpesaProvider()): Promise<Payment> {
  if (p.status !== "pending" || !p.providerRef) return p;
  const ageSeconds = (Date.now() - p.createdAt.getTime()) / 1000;
  if (ageSeconds >= 5 || env().MPESA_ENV === "mock") {
    try {
      const s = await provider.queryStatus(p.providerRef);
      if (s.state !== "pending") await settle(p.id, { success: s.state === "success", code: s.code, description: s.description, receipt: s.receipt });
    } catch (e) {
      if (!(e instanceof PaymentError)) throw e;
    }
  }
  if (ageSeconds > 300) {
    await settle(p.id, { success: false, code: "timeout", description: "No response from M-Pesa. Please try again." });
  }
  const [fresh] = await db.select().from(schema.payments).where(eq(schema.payments.id, p.id));
  return fresh!;
}

/** Worker job: re-check payments still pending after a minute. */
export async function reconcilePending(): Promise<number> {
  const stale = await db.select().from(schema.payments)
    .where(and(eq(schema.payments.status, "pending"), lt(schema.payments.createdAt, new Date(Date.now() - 60_000))))
    .orderBy(desc(schema.payments.createdAt)).limit(100);
  for (const p of stale) await refresh(p);
  return stale.length;
}
