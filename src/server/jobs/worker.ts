/**
 * Background worker: `npm run worker` (one or more instances; pg-boss
 * coordinates them through Postgres, so jobs never run twice).
 */
import "dotenv/config";
import { startWorker } from "./startWorker";

const b = await startWorker();

const stop = async () => {
  console.log("[worker] stopping…");
  await b.stop({ graceful: true, timeout: 20_000 });
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
