import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { addDays, formatDate, todayInNairobi } from "@/lib/dates";
import { db, schema } from "../db";
import { env } from "../env";
import { queueMessage } from "../jobs/queue";
import { accessUntil } from "./billing";

/**
 * Daily: SMS + email anyone whose access ends within RENEWAL_REMINDER_DAYS,
 * once per access period (reminderSentFor remembers which end date we covered).
 */
export async function sendRenewalReminders(today = todayInNairobi()): Promise<number> {
  const last = addDays(today, env().RENEWAL_REMINDER_DAYS - 1);
  const until = sql<string>`greatest(${schema.users.trialEndsAt}, coalesce(${schema.users.paidUntil}, ${schema.users.trialEndsAt}))`;
  const due = await db.select().from(schema.users).where(and(
    sql`${until} between ${today} and ${last}`,
    or(isNull(schema.users.reminderSentFor), sql`${schema.users.reminderSentFor} <> ${until}`),
  )).limit(1000);
  const app = env().APP_NAME;
  for (const u of due) {
    const end = accessUntil(u);
    const onTrial = !u.paidUntil || u.paidUntil < u.trialEndsAt;
    const when = end === today ? "today" : `on ${formatDate(end, { weekday: "long", day: "numeric", month: "short" })}`;
    await queueMessage({
      kind: "renewal_reminder", email: u.email, name: u.name, phone: u.phone,
      subject: `Your ${app} ${onTrial ? "free trial" : "plan"} ends ${when}`,
      text: `Hi ${u.name}, your ${app} ${onTrial ? "free trial" : "subscription"} ends ${when}. ` +
        `Renew with M-Pesa at ${env().PUBLIC_URL}/app to keep editing your budget.`,
    });
    await db.update(schema.users).set({ reminderSentFor: end }).where(eq(schema.users.id, u.id));
  }
  return due.length;
}

export async function housekeeping() {
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
  await db.delete(schema.passwordResets).where(lt(schema.passwordResets.expiresAt, new Date(Date.now() - 86_400_000)));
  await db.execute(sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
}
