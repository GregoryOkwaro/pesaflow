"use client";
/** Browser-side API client. Adds the CSRF header and turns error responses into ApiClientError. */

export class ApiClientError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : "Request failed");
  }
}

type Listener = (status: number, body: Record<string, unknown>) => void;
const listeners = new Set<Listener>();
/** Lets the app react globally to 401 (logged out) and 402 (subscription expired). */
export function onApiError(fn: Listener) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-Requested-With": "fetch" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(path, { method, headers, credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiClientError(0, { error: "You appear to be offline. Check your connection." });
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : {};
  if (!res.ok) {
    listeners.forEach((l) => l(res.status, data));
    throw new ApiClientError(res.status, data);
  }
  return data as T;
}
