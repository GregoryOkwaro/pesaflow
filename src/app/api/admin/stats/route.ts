import { sql } from "drizzle-orm";
import { todayInNairobi } from "@/lib/dates";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { ApiError, handler, json } from "@/server/http";

export const GET = handler(async () => {
  const user = await requireUser();
  if (!user.isAdmin) throw new ApiError(403, "Admins only.");
  const today = todayInNairobi();
  const [row] = await db.execute<Record<string, string>>(sql`
    SELECT
      (SELECT count(*) FROM users) AS users,
      (SELECT count(*) FROM users WHERE paid_until >= ${today}) AS paying_users,
      (SELECT count(*) FROM users WHERE trial_ends_at >= ${today} AND (paid_until IS NULL OR paid_until < ${today})) AS trial_users,
      (SELECT coalesce(sum(amount), 0) FROM payments WHERE status = 'success') AS revenue_kes,
      (SELECT coalesce(sum(amount), 0) FROM payments WHERE status = 'success' AND created_at >= now() - interval '30 days') AS revenue_30d_kes,
      (SELECT count(*) FROM payments WHERE status = 'failed' AND result_desc LIKE 'Amount mismatch%') AS payments_needing_review`);
  return json(Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, Number(v)])));
});
