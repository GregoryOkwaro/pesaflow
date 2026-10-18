import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = ReturnType<typeof drizzle<typeof schema>>;
const g = globalThis as unknown as { __pfSql?: postgres.Sql; __pfDb?: DB };

function connect(): DB {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // One pool per process; reused across dev hot reloads.
  g.__pfSql ??= postgres(url, { max: Number(process.env.DB_POOL_MAX ?? 10), idle_timeout: 30, prepare: true });
  g.__pfDb ??= drizzle(g.__pfSql, { schema });
  return g.__pfDb;
}

export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    const real = connect() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;

export async function closeDb() {
  await g.__pfSql?.end({ timeout: 5 });
  g.__pfSql = undefined;
  g.__pfDb = undefined;
}

export { schema };
