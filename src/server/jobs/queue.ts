/**
 * Background jobs on pg-boss (a Postgres-backed queue: no Redis to run).
 * The web app only *sends* jobs; `npm run worker` processes them.
 * JOBS_INLINE=1 runs handlers immediately in-process instead (local dev, tests).
 */
import { PgBoss } from "pg-boss";
import { deliver, type Message } from "../notify/channels";

export const QUEUES = {
  sendMessage: "send-message",
  reconcilePayments: "reconcile-payments",
  renewalReminders: "renewal-reminders",
  housekeeping: "housekeeping",
} as const;

const g = globalThis as unknown as { __pfBoss?: Promise<PgBoss> };

export function boss(opts: { worker?: boolean } = {}): Promise<PgBoss> {
  g.__pfBoss ??= (async () => {
    const b = new PgBoss({
      connectionString: process.env.DATABASE_URL!,
      max: 3,
      application_name: opts.worker ? "pesaflow-worker" : "pesaflow-web",
      // Only the worker runs maintenance and cron scheduling.
      supervise: !!opts.worker,
      schedule: !!opts.worker,
    });
    b.on("error", (e) => console.error("[pg-boss]", e));
    await b.start();
    for (const name of Object.values(QUEUES)) await b.createQueue(name);
    return b;
  })();
  return g.__pfBoss;
}

const inline = () => process.env.JOBS_INLINE === "1";

/** Queue a message (retried with backoff by the worker). Never throws into the request. */
export async function queueMessage(msg: Message): Promise<void> {
  if (inline()) {
    await deliver(msg).catch((e) => console.error("[notify]", e));
    return;
  }
  try {
    await (await boss()).send(QUEUES.sendMessage, { ...msg }, { retryLimit: 5, retryDelay: 30, retryBackoff: true, expireInSeconds: 600 });
  } catch (e) {
    console.error("[jobs] could not queue message, sending inline", e);
    await deliver(msg).catch((err) => console.error("[notify]", err));
  }
}
