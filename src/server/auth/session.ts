import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db, schema, type DbOrTx } from "../db";
import { env } from "../env";
import { ApiError } from "../http";
import { subscriptionStatus } from "../services/billing";
import { newToken, sha256 } from "./crypto";

export const SESSION_COOKIE = "pf_session";
export type User = typeof schema.users.$inferSelect;

export async function createSession(userId: string, tx: DbOrTx = db): Promise<{ token: string; expires: Date }> {
  const token = newToken();
  const expires = new Date(Date.now() + env().SESSION_DAYS * 86_400_000);
  await tx.insert(schema.sessions).values({ tokenHash: sha256(token), userId, expiresAt: expires });
  await tx.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
  return { token, expires };
}

export async function setSessionCookie(token: string, expires: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env().PUBLIC_URL.startsWith("https://"),
    path: "/",
    expires,
  });
}

export async function clearSessionCookie() {
  (await cookies()).set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

export async function userForToken(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const rows = await db
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, sha256(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0]?.user ?? null;
}

export async function currentUser(): Promise<User | null> {
  return userForToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new ApiError(401, "Please log in.");
  return user;
}

/** Writes need an active trial or subscription; reads always work, so nobody loses their data. */
export async function requireActive(): Promise<User> {
  const user = await requireUser();
  if (!subscriptionStatus(user).active) {
    throw new ApiError(402, "Your subscription has expired. Renew with M-Pesa to keep editing.", { code: "subscription_expired" });
  }
  return user;
}

export async function endSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token)));
  await clearSessionCookie();
}
