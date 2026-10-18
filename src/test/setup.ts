import "dotenv/config";
import { vi } from "vitest";
import { testDatabaseUrl } from "./globalSetup";

Object.assign(process.env, {
  DATABASE_URL: testDatabaseUrl(),
  MPESA_ENV: "mock",
  MPESA_CALLBACK_SECRET: "test-callback-secret-0123456789",
  NOTIFY_ENV: "mock",
  JOBS_INLINE: "1",
  RATE_LIMIT_DISABLED: "1",
  PUBLIC_URL: "http://localhost:3000",
});

/** next/headers cookies() backed by a jar the test client controls. */
export const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string, opts?: { maxAge?: number }) => {
      if (!value || opts?.maxAge === 0) cookieJar.delete(name);
      else cookieJar.set(name, value);
    },
  }),
}));
