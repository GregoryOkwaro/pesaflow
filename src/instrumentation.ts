/**
 * Runs once when the Next.js server starts. With RUN_WORKER_IN_WEB=1 (single-process
 * hosting such as Render's free plan, which has no background workers), the web
 * server applies database migrations before serving and runs the background jobs
 * itself. Normally a separate worker does both (Dockerfile.worker).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.RUN_WORKER_IN_WEB !== "1") return;
  const { runMigrations } = await import("./server/db/migrations");
  await runMigrations(process.env.DATABASE_URL!);
  console.log("[startup] migrations applied");
  const { startWorker } = await import("./server/jobs/startWorker");
  await startWorker();
}
