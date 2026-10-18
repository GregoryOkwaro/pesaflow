import { and, eq } from "drizzle-orm";
import { requireUser } from "@/server/auth/session";
import { db, schema } from "@/server/db";
import { ApiError, handler, json } from "@/server/http";
import { idParam, type IdCtx } from "@/server/params";
import { paymentJson, refresh } from "@/server/services/billing";
import { userJson } from "@/server/services/users";

/** Polled by the payment dialog; asks M-Pesa directly if the callback hasn't arrived yet. */
export const GET = handler<IdCtx>(async (_req, ctx) => {
  const user = await requireUser();
  const [p] = await db.select().from(schema.payments)
    .where(and(eq(schema.payments.id, await idParam(ctx)), eq(schema.payments.userId, user.id))).limit(1);
  if (!p) throw new ApiError(404, "errors.notFound");
  const fresh = await refresh(p);
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  return json({ payment: paymentJson(fresh), user: userJson(u!) });
});
