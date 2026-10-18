import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { formatDate, todayIn } from "@/lib/dates";
import { dirOf, isLocale, translator } from "@/i18n/translate";
import { db, schema } from "../db";
import { env } from "../env";
import { queueMessage } from "../jobs/queue";
import { accessUntil } from "./billing";

const REMINDER_HOUR = 9;

/**
 * Runs hourly. Reminds (email + SMS where supported) anyone whose access ends within
 * RENEWAL_REMINDER_DAYS, at about 9am in *their* time zone, once per access period.
 * Card subscribers who will auto-renew are skipped. `force` ignores the local hour (tests, manual runs).
 */
export async function sendRenewalReminders(opts: { force?: boolean; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const until = sql<string>`greatest(${schema.users.trialEndsAt}, coalesce(${schema.users.paidUntil}, ${schema.users.trialEndsAt}))`;
  const localToday = sql<string>`(${now.toISOString()}::timestamptz at time zone ${schema.users.timezone})::date`;
  const conditions = [
    sql`${until} between ${localToday} and ${localToday} + ${env().RENEWAL_REMINDER_DAYS - 1}::int`,
    or(isNull(schema.users.reminderSentFor), sql`${schema.users.reminderSentFor} <> ${until}`),
    or(isNull(schema.users.paddleSubscriptionStatus), sql`${schema.users.paddleSubscriptionStatus} not in ('active', 'trialing')`),
  ];
  if (!opts.force) conditions.push(sql`extract(hour from ${now.toISOString()}::timestamptz at time zone ${schema.users.timezone}) = ${REMINDER_HOUR}`);
  const due = await db.select().from(schema.users).where(and(...conditions)).limit(2000);

  const app = env().APP_NAME;
  for (const u of due) {
    const locale = isLocale(u.locale) ? u.locale : "en";
    const { t } = translator(locale);
    const today = todayIn(u.timezone, now);
    const end = accessUntil(u);
    const onTrial = !u.paidUntil || u.paidUntil < u.trialEndsAt;
    const when = end === today ? t("notify.whenToday")
      : t("notify.whenOn", { date: formatDate(end, { weekday: "long", day: "numeric", month: "short" }, locale) });
    const vars = { app, name: u.name, when, url: `${env().PUBLIC_URL}/app` };
    await queueMessage({
      kind: "renewal_reminder", email: u.email, name: u.name, phone: u.phone, dir: dirOf(locale),
      subject: t(onTrial ? "notify.reminderSubjectTrial" : "notify.reminderSubjectPlan", vars),
      text: t(onTrial ? "notify.reminderBodyTrial" : "notify.reminderBodyPlan", vars),
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

