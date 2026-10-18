/** Applies SQL migrations from ./drizzle. Run: npm run db:migrate (also runs on container start). */
import "dotenv/config";
import { runMigrations } from "./migrations";

await runMigrations(process.env.DATABASE_URL!);
console.log("Migrations applied.");
