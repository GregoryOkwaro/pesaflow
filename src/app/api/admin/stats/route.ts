import { sql } from "drizzle-orm";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { ApiError, handler, json } from "@/server/http";

/** Admin metrics. "Today" is per user (their own time zone), so it's computed in SQL. */
export const GET = handler(async () => {
  const user = await requireUser();
  if (!user.isAdmin) throw new ApiError(403, "errors.adminOnly");
  const localToday = sql`(now() at time zone timezone)::date`;
  const [counts] = await db.execute<Record<string, string>>(sql`
    SELECT
      count(*) AS users,
      count(*) FILTER (WHERE paid_until >= ${localToday}) AS paying_users,
      count(*) FILTER (WHERE trial_ends_at >= ${localToday} AND (paid_until IS NULL OR paid_until < ${localToday})) AS trial_users,
      count(*) FILTER (WHERE paddle_subscription_status IN ('active', 'trialing')) AS card_subscribers
    FROM users`);
  const byCountry = await db.execute<{ country: string; users: string }>(sql`
    SELECT country, count(*) AS users FROM users GROUP BY country ORDER BY count(*) DESC LIMIT 20`);
  const revenue = await db.execute<{ provider: string; currency: string; total_minor: string; last_30d_minor: string }>(sql`
    SELECT provider, currency, sum(amount) AS total_minor,
           coalesce(sum(amount) FILTER (WHERE created_at >= now() - interval '30 days'), 0) AS last_30d_minor
    FROM payments WHERE status = 'success' GROUP BY provider, currency ORDER BY provider, currency`);
  const [review] = await db.execute<{ n: string }>(sql`
    SELECT count(*) AS n FROM payments WHERE status = 'failed' AND result_desc LIKE 'Amount mismatch%'`);
  return json({
    ...Object.fromEntries(Object.entries(counts ?? {}).map(([k, v]) => [k, Number(v)])),
    users_by_country: byCountry.map((r) => ({ country: r.country, users: Number(r.users) })),
    revenue: revenue.map((r) => ({ provider: r.provider, currency: r.currency, total_minor: Number(r.total_minor), last_30d_minor: Number(r.last_30d_minor) })),
    payments_needing_review: Number(review?.n ?? 0),
  });
});
