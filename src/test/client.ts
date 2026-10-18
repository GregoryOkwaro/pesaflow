/**
 * Calls route handlers in-process, like a browser would: each TestClient has
 * its own session cookie, and requests carry the CSRF header by default.
 */
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { cookieJar } from "./setup";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each route types its own params
type RouteModule = Record<string, (req: NextRequest, ctx: any) => Promise<Response>>;

export class TestClient {
  session?: string;

  async call<T = any>(mod: RouteModule, method: string, opts: { params?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {}) {
    cookieJar.clear();
    if (this.session) cookieJar.set("pf_session", this.session);
    const req = new NextRequest("http://localhost:3000/api/test", {
      method,
      headers: { "x-requested-with": "fetch", "content-type": "application/json", ...opts.headers },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const res = await mod[method]!(req, { params: Promise.resolve(opts.params ?? {}) });
    this.session = cookieJar.get("pf_session"); // set, replaced or cleared by the handler
    const text = await res.text();
    let data: T;
    try { data = JSON.parse(text); } catch { data = text as T; }
    return { status: res.status, data };
  }
}

export async function resetDb() {
  await db.execute(sql`TRUNCATE users, sessions, password_resets, budgets, accounts, items, payments, rate_limits RESTART IDENTITY CASCADE`);
}
