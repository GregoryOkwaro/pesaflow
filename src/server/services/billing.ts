/**
 * Subscriptions. Two rails:
 *  - M-Pesa (Kenya): prepaid plans via Daraja STK push, in KES.
 *  - Paddle (everywhere): recurring card/PayPal/local-method subscriptions; Paddle is
 *    merchant of record and handles tax. We mirror its webhooks.
 *
 * Access model: free trial, then read-only until paid. Access ends on `paidUntil`
 * (a date in the user's own time zone). M-Pesa payments extend from whichever is
 * later of yesterday, the trial end or current paid-until, so paying early never
 * loses days. Paddle sets paid-until to the end of the paid billing period.
 */
import { and, desc, eq, lt } from "drizzle-orm";
import { addDays, diffDays, formatDate, todayIn, type ISODate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { dirOf, translator, isLocale } from "@/i18n/translate";
import { db, schema } from "../db";
import { env, isPlan, mpesaPrice, PLAN_DAYS, type PlanKey } from "../env";
import { ApiError } from "../http";
import { queueMessage } from "../jobs/queue";
import { mpesaProvider, PaymentError, type PaymentProvider } from "../payments";
import { parseSubscription, parseTransaction, type PaddleEvent } from "../payments/paddle";
import { normalizeMpesaPhone } from "../payments/phone";

type User = typeof schema.users.$inferSelect;
type Payment = typeof schema.payments.$inferSelect;

export const userToday = (u: Pick<User, "timezone">) => todayIn(u.timezone);

export function accessUntil(user: Pick<User, "trialEndsAt" | "paidUntil">): ISODate {
  return user.paidUntil && user.paidUntil > user.trialEndsAt ? user.paidUntil : user.trialEndsAt;
}

export function subscriptionStatus(user: Pick<User, "trialEndsAt" | "paidUntil" | "timezone"> & Partial<Pick<User, "paddleSubscriptionStatus">>, today: ISODate = userToday(user)) {
  const until = accessUntil(user);
  const active = until >= today;
  const paid = !!user.paidUntil && user.paidUntil >= today;
  return {
    active,
    onTrial: active && !paid,
    accessUntil: until,
    daysLeft: active ? diffDays(until, today) + 1 : 0,
    card: user.paddleSubscriptionStatus ?? null, // "active" | "canceled" | "past_due" | null
  };
}

export function paymentJson(p: Payment) {
  return {
    id: p.id, provider: p.provider, plan: p.plan, amount: p.amount, currency: p.currency, phone: p.phone ?? "",
    status: p.status, resultDesc: p.resultDesc ?? "", receipt: p.receipt ?? "", createdAt: p.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------- M-Pesa

export async function startPayment(user: User, planKey: string, rawPhone: string, provider: PaymentProvider = mpesaProvider()) {
  if (!isPlan(planKey)) throw new ApiError(400, "errors.unknownPlan");
  const phone = normalizeMpesaPhone(rawPhone);
  if (!phone) throw new ApiError(400, "errors.mpesaPhone");
  const amount = mpesaPrice(planKey); // KES cents
  const [p] = await db.insert(schema.payments).values({ userId: user.id, provider: provider.name, plan: planKey, amount, currency: "KES", phone }).returning();
  try {
    const res = await provider.startPayment({ phone, amount: amount / 100, reference: `PF${user.id.slice(-8)}`, description: `${planKey} plan` });
    const [updated] = await db.update(schema.payments)
      .set({ providerRef: res.providerRef, merchantRef: res.merchantRef, updatedAt: new Date() })
      .where(eq(schema.payments.id, p!.id)).returning();
    return { payment: updated! };
  } catch (e) {
    const msg = e instanceof PaymentError ? e.message : "errors.paymentStart";
    await db.update(schema.payments).set({ status: "failed", resultDesc: msg, updatedAt: new Date() }).where(eq(schema.payments.id, p!.id));
    if (!(e instanceof PaymentError)) console.error(e);
    throw new ApiError(502, msg);
  }
}

/**
 * Moves a pending payment to success/failed exactly once, and on success extends
 * access in the same transaction (row locks stop a callback and a status query
 * from both applying it).
 */
export async function settle(paymentId: string, outcome: { success: boolean; code: string; description: string; receipt?: string }): Promise<boolean> {
  const changed = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(schema.payments).where(eq(schema.payments.id, paymentId)).for("update");
    if (!p || p.status !== "pending") return false;
    let { success, description } = outcome;
    if (success && outcome.receipt) {
      const dup = await tx.select({ id: schema.payments.id }).from(schema.payments)
        .where(and(eq(schema.payments.provider, p.provider), eq(schema.payments.receipt, outcome.receipt))).limit(1);
      if (dup.length) [success, description] = [false, "Duplicate receipt"];
    }
    await tx.update(schema.payments).set({
      status: success ? "success" : "failed", resultCode: outcome.code, resultDesc: description,
      receipt: success ? outcome.receipt ?? null : null, applied: success, updatedAt: new Date(),
    }).where(eq(schema.payments.id, p.id));
    if (!success) return true;
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, p.userId)).for("update");
    const from = [addDays(userToday(user!), -1), accessUntil(user!)].sort().at(-1)!;
    await tx.update(schema.users).set({ paidUntil: addDays(from, PLAN_DAYS[p.plan as PlanKey]), reminderSentFor: null }).where(eq(schema.users.id, user!.id));
    return true;
  });
  if (changed && outcome.success) await sendReceipt(paymentId);
  return changed;
}

async function sendReceipt(paymentId: string) {
  const [row] = await db.select({ p: schema.payments, u: schema.users }).from(schema.payments)
    .innerJoin(schema.users, eq(schema.users.id, schema.payments.userId)).where(eq(schema.payments.id, paymentId));
  if (!row || row.p.status !== "success") return;
  const locale = isLocale(row.u.locale) ? row.u.locale : "en";
  const { t } = translator(locale);
  const app = env().APP_NAME;
  await queueMessage({
    kind: "payment_receipt", email: row.u.email, name: row.u.name, phone: null, dir: dirOf(locale),
    subject: t("notify.receiptSubject", { app }),
    text: t("notify.receiptBody", {
      name: row.u.name, app,
      amount: formatMoney(row.p.amount, row.p.currency, locale),
      plan: t(`billing.${row.p.plan as PlanKey}`),
      receipt: row.p.receipt ? ` (${row.p.provider === "mpesa" ? "M-Pesa " : ""}${row.p.receipt})` : "",
      date: formatDate(accessUntil(row.u), { day: "numeric", month: "long", year: "numeric" }, locale),
    }),
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
  const paidMinor = Math.round((cb.amount ?? 0) * 100);
  if (success && paidMinor < p.amount) {
    success = false;
    description = `Amount mismatch: paid ${cb.amount ?? 0}, expected ${p.amount / 100}. Receipt ${cb.receipt ?? "-"} needs manual review.`;
  }
  await settle(p.id, { success, code: cb.code, description, receipt: success ? cb.receipt : undefined });
}

/** Fallback when the callback is late or lost: ask the provider directly. */
export async function refresh(p: Payment, provider: PaymentProvider = mpesaProvider()): Promise<Payment> {
  if (p.status !== "pending" || !p.providerRef || p.provider !== "mpesa") return p;
  const ageSeconds = (Date.now() - p.createdAt.getTime()) / 1000;
  if (ageSeconds >= 5 || env().MPESA_ENV === "mock") {
    try {
      const s = await provider.queryStatus(p.providerRef);
      if (s.state !== "pending") await settle(p.id, { success: s.state === "success", code: s.code, description: s.description, receipt: s.receipt });
    } catch (e) {
      if (!(e instanceof PaymentError)) throw e;
    }
  }
  if (ageSeconds > 300) await settle(p.id, { success: false, code: "timeout", description: "errors.mpesaTimeout" });
  const [fresh] = await db.select().from(schema.payments).where(eq(schema.payments.id, p.id));
  return fresh!;
}

/** Worker job: re-check M-Pesa payments still pending after a minute. */
export async function reconcilePending(): Promise<number> {
  const stale = await db.select().from(schema.payments)
    .where(and(eq(schema.payments.status, "pending"), eq(schema.payments.provider, "mpesa"), lt(schema.payments.createdAt, new Date(Date.now() - 60_000))))
    .orderBy(desc(schema.payments.createdAt)).limit(100);
  for (const p of stale) await refresh(p);
  return stale.length;
}

// ---------------------------------------------------------------- Paddle

/** Card checkout guard: one card subscription per account. */
export function assertCanStartCardCheckout(user: User, plan: string) {
  if (!isPlan(plan)) throw new ApiError(400, "errors.unknownPlan");
  if (user.paddleSubscriptionId && ["active", "trialing", "past_due"].includes(user.paddleSubscriptionStatus ?? "")) {
    throw new ApiError(409, "errors.cardSubscriptionActive");
  }
}

const tsToUserDate = (iso: string, tz: string) => todayIn(tz, new Date(iso));

async function findUserForPaddle(userId: string | null, customerId: string | null, subscriptionId: string | null): Promise<User | undefined> {
  if (userId && /^[0-9a-f-]{36}$/i.test(userId)) {
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (u) return u;
  }
  if (subscriptionId) {
    const [u] = await db.select().from(schema.users).where(eq(schema.users.paddleSubscriptionId, subscriptionId)).limit(1);
    if (u) return u;
  }
  if (customerId) {
    const [u] = await db.select().from(schema.users).where(eq(schema.users.paddleCustomerId, customerId)).limit(1);
    return u;
  }
  return undefined;
}

/**
 * Handles a verified Paddle webhook. Idempotent: a completed transaction is
 * recorded once (unique provider+ref), and subscription updates only ever move
 * paid-until forward.
 */
export async function handlePaddleEvent(ev: PaddleEvent): Promise<void> {
  if (ev.event_type === "transaction.completed" || ev.event_type === "transaction.paid") {
    const txn = parseTransaction(ev.data);
    const user = await findUserForPaddle(txn.userId, txn.customerId, txn.subscriptionId);
    if (!user) return console.warn(`[paddle] no user for transaction ${txn.id}`);
    const plan = isPlan(txn.plan) ? txn.plan : "monthly";
    const inserted = await db.insert(schema.payments).values({
      userId: user.id, provider: "paddle", plan, amount: txn.totalMinor, currency: txn.currency,
      providerRef: txn.id, status: "success", receipt: txn.id, applied: true, resultCode: "completed",
    }).onConflictDoNothing().returning({ id: schema.payments.id });
    const periodEnd = txn.periodEndsAt ? tsToUserDate(txn.periodEndsAt, user.timezone) : addDays(userToday(user), PLAN_DAYS[plan]);
    await db.transaction(async (tx) => {
      const [u] = await tx.select().from(schema.users).where(eq(schema.users.id, user.id)).for("update");
      const paidUntil = u!.paidUntil && u!.paidUntil > periodEnd ? u!.paidUntil : periodEnd;
      await tx.update(schema.users).set({
        paidUntil, reminderSentFor: null,
        paddleCustomerId: txn.customerId ?? u!.paddleCustomerId,
        paddleSubscriptionId: txn.subscriptionId ?? u!.paddleSubscriptionId,
        paddleSubscriptionStatus: u!.paddleSubscriptionStatus ?? "active",
      }).where(eq(schema.users.id, user.id));
    });
    if (inserted.length) await sendReceipt(inserted[0]!.id);
    return;
  }

  if (ev.event_type.startsWith("subscription.")) {
    const sub = parseSubscription(ev.data);
    const user = await findUserForPaddle(sub.userId, sub.customerId, sub.id);
    if (!user) return console.warn(`[paddle] no user for subscription ${sub.id}`);
    const status = sub.status === "active" && sub.scheduledCancel ? "canceled" : sub.status;
    const periodEnd = sub.periodEndsAt ? tsToUserDate(sub.periodEndsAt, user.timezone) : null;
    await db.transaction(async (tx) => {
      const [u] = await tx.select().from(schema.users).where(eq(schema.users.id, user.id)).for("update");
      const extend = periodEnd && ["active", "trialing"].includes(sub.status) && (!u!.paidUntil || periodEnd > u!.paidUntil);
      await tx.update(schema.users).set({
        paddleCustomerId: sub.customerId ?? u!.paddleCustomerId,
        paddleSubscriptionId: sub.id,
        paddleSubscriptionStatus: status,
        paddleManageUrl: sub.manageUrl ?? u!.paddleManageUrl,
        paddleCancelUrl: sub.cancelUrl ?? u!.paddleCancelUrl,
        ...(extend ? { paidUntil: periodEnd, reminderSentFor: null } : {}),
      }).where(eq(schema.users.id, user.id));
    });
  }
}
