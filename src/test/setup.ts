import "dotenv/config";
import { vi } from "vitest";
import { testDatabaseUrl } from "./globalSetup";

Object.assign(process.env, {
  DATABASE_URL: testDatabaseUrl(),
  MPESA_ENV: "mock",
  MPESA_CALLBACK_SECRET: "test-callback-secret-0123456789",
  PADDLE_ENV: "mock",
  PADDLE_WEBHOOK_SECRET: "pdl_ntfset_test_secret",
  NOTIFY_ENV: "mock",
  JOBS_INLINE: "1",
  RATE_LIMIT_DISABLED: "1",
  PUBLIC_URL: "http://localhost:3000",
});

/** next/headers cookies()/headers() backed by state the test client controls per request. */
export const cookieJar = new Map<string, string>();
export const requestHeaders = { current: new Headers() };
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string, opts?: { maxAge?: number }) => {
      if (!value || opts?.maxAge === 0) cookieJar.delete(name);
      else cookieJar.set(name, value);
    },
  }),
  headers: async () => requestHeaders.current,
}));
