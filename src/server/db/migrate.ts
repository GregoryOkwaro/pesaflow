/** Applies SQL migrations from ./drizzle. Run: npm run db:migrate (also runs on container start). */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
await sql.end();
console.log("Migrations applied.");
