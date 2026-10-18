/** Fixed-window rate limiter stored in Postgres, so it holds across every app instance. */
import { sql } from "drizzle-orm";
import { db } from "./db";
import type { MessageKey } from "@/i18n/translate";
import { ApiError } from "./http";

export async function hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const rows = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) THEN now() ELSE rate_limits.window_start END
    RETURNING count`);
  return Number(rows[0]?.count ?? 0) <= limit;
}

export async function enforce(key: string, limit: number, windowSeconds: number, message: MessageKey) {
  if (process.env.RATE_LIMIT_DISABLED === "1") return;
  if (!(await hit(key, limit, windowSeconds))) throw new ApiError(429, message);
}
