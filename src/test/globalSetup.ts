/** Creates (if needed) and migrates the pesaflow_test database once per test run. */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export function testDatabaseUrl(): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = "/pesaflow_test";
  return url.toString();
}

export default async function setup() {
  const admin = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  const exists = await admin`select 1 from pg_database where datname = 'pesaflow_test'`;
  if (!exists.length) await admin.unsafe("create database pesaflow_test");
  await admin.end();
  const sql = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  await sql.end();
}
