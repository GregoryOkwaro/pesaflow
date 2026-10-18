/**
 * Calls route handlers in-process, like a browser would: each TestClient keeps its
 * own cookies (session, language), and requests carry the CSRF header by default.
 */
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { cookieJar, requestHeaders } from "./setup";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each route types its own params
type RouteModule = Record<string, (req: NextRequest, ctx: any) => Promise<Response>>;

export class TestClient {
  cookies = new Map<string, string>();
  constructor(public acceptLanguage = "en") {}

  get session() { return this.cookies.get("pf_session"); }
  set session(v: string | undefined) { if (v) this.cookies.set("pf_session", v); else this.cookies.delete("pf_session"); }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async call<T = any>(mod: RouteModule, method: string, opts: { params?: Record<string, string>; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) {
    cookieJar.clear();
    for (const [k, v] of this.cookies) cookieJar.set(k, v);
    const headers = { "x-requested-with": "fetch", "content-type": "application/json", "accept-language": this.acceptLanguage, ...opts.headers };
    const req = new NextRequest("http://localhost:3000/api/test", {
      method, headers, body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    });
    requestHeaders.current = new Headers(headers);
    const res = await mod[method]!(req, { params: Promise.resolve(opts.params ?? {}) });
    this.cookies = new Map(cookieJar); // set, replaced or cleared by the handler
    const text = await res.text();
    let data: T;
    try { data = JSON.parse(text); } catch { data = text as T; }
    return { status: res.status, data };
  }
}

export async function resetDb() {
  await db.execute(sql`TRUNCATE users, sessions, password_resets, budgets, accounts, items, payments, rate_limits RESTART IDENTITY CASCADE`);
}
