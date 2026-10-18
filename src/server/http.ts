/** Shared plumbing for route handlers: typed errors, JSON responses, CSRF, client IP, error translation. */
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { requestLocale } from "@/i18n/server";
import { translator, type MessageKey, type Vars } from "@/i18n/translate";
import { env } from "./env";

/**
 * `key` is a message key ("errors.wrongLogin"), translated into the visitor's
 * language when the response is sent. Provider messages (e.g. from Daraja) may
 * be passed through as plain text.
 */
export class ApiError extends Error {
  constructor(public status: number, public key: MessageKey | (string & {}), public vars: Vars = {}, public extra: Record<string, unknown> = {}) {
    super(key);
  }
}

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

async function errorResponse(status: number, key: string, vars: Vars = {}, extra: Record<string, unknown> = {}) {
  const t = translator(await requestLocale().catch(() => "en" as const));
  return json({ error: t.tMaybe(key, vars), code: key, ...extra }, status);
}

/**
 * Wraps a route handler: CSRF check for state-changing methods, errors -> translated JSON.
 * CSRF: our JS sends `X-Requested-With: fetch`; browsers can't add custom headers cross-site
 * without a CORS preflight we never approve. The Origin header, when present, must be ours.
 */
export function handler<C = unknown>(fn: Handler<C>, opts: { csrf?: boolean } = {}): Handler<C> {
  return async (req, ctx) => {
    try {
      if ((opts.csrf ?? true) && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        if (req.headers.get("x-requested-with") !== "fetch") throw new ApiError(403, "errors.missingHeader");
        const origin = req.headers.get("origin");
        if (origin && new URL(origin).host !== req.nextUrl.host && new URL(origin).host !== new URL(env().PUBLIC_URL).host) {
          throw new ApiError(403, "errors.crossSite");
        }
      }
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) return errorResponse(e.status, e.key, e.vars, e.extra);
      if (e instanceof ZodError) {
        const issue = e.issues[0];
        const key = issue?.message?.startsWith("errors.") ? issue.message : "errors.invalidInput";
        const maximum = (issue as unknown as { maximum?: number | bigint })?.maximum;
        return errorResponse(400, key, maximum !== undefined ? { max: Number(maximum) } : {});
      }
      console.error(e);
      return errorResponse(500, "errors.generic");
    }
  };
}

export async function body<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  const text = await req.text();
  if (text.length > 64 * 1024) throw new ApiError(413, "errors.tooLarge");
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(400, "errors.invalidJson");
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
