import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/server/auth/session";
import { db, schema } from "@/server/db";
import { handler, json } from "@/server/http";
import { paymentJson } from "@/server/services/billing";

export const GET = handler(async () => {
  const user = await requireUser();
  const rows = await db.select().from(schema.payments).where(eq(schema.payments.userId, user.id)).orderBy(desc(schema.payments.createdAt)).limit(50);
  return json({ payments: rows.map(paymentJson) });
});
