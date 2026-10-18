/** Shared plumbing for route handlers: typed errors, JSON responses, CSRF and client IP. */
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { env } from "./env";

export class ApiError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/**
 * Wraps a route handler: CSRF check for state-changing methods, error -> JSON.
 * CSRF: our JS sends `X-Requested-With: fetch`; browsers can't add custom
 * headers cross-site without a CORS preflight we never approve. The Origin
 * header, when present, must also be our own.
 */
export function handler<C = unknown>(fn: Handler<C>, opts: { csrf?: boolean } = {}): Handler<C> {
  return async (req, ctx) => {
    try {
      if ((opts.csrf ?? true) && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        if (req.headers.get("x-requested-with") !== "fetch") throw new ApiError(403, "Missing request header.");
        const origin = req.headers.get("origin");
        if (origin && new URL(origin).host !== req.nextUrl.host && new URL(origin).host !== new URL(env().PUBLIC_URL).host) {
          throw new ApiError(403, "Cross-site request blocked.");
        }
      }
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) return json({ error: e.message, ...e.extra }, e.status);
      if (e instanceof ZodError) return json({ error: e.issues[0]?.message ?? "Invalid input." }, 400);
      console.error(e);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  };
}

export async function body<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  const text = await req.text();
  if (text.length > 64 * 1024) throw new ApiError(413, "Request too large.");
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(400, "Invalid JSON.");
    }
  }
  return schema.parse(data);
}

/** Behind Cloudflare, CF-Connecting-IP is set by Cloudflare itself. Lock the origin to Cloudflare IPs in production. */
export function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}
