/**
 * Background worker: `npm run worker` (one or more instances; pg-boss
 * coordinates them through Postgres, so jobs never run twice).
 */
import "dotenv/config";
import { deliver, type Message } from "../notify/channels";
import { reconcilePending } from "../services/billing";
import { housekeeping, sendRenewalReminders } from "../services/reminders";
import { boss, QUEUES } from "./queue";

const b = await boss({ worker: true });
const tz = "Africa/Nairobi";

await b.work<Message>(QUEUES.sendMessage, async (jobs) => {
  for (const job of jobs) await deliver(job.data); // throwing makes pg-boss retry with backoff
});
await b.work(QUEUES.reconcilePayments, async () => {
  const n = await reconcilePending();
  if (n) console.log(`[worker] re-checked ${n} pending payment(s)`);
});
await b.work(QUEUES.renewalReminders, async () => {
  console.log(`[worker] renewal reminders sent: ${await sendRenewalReminders()}`);
});
await b.work(QUEUES.housekeeping, async () => housekeeping());

await b.schedule(QUEUES.reconcilePayments, "* * * * *", null, { tz });
await b.schedule(QUEUES.renewalReminders, "0 * * * *", null, { tz }); // hourly: each user is reminded at 9am their time
await b.schedule(QUEUES.housekeeping, "30 3 * * *", null, { tz });

console.log("[worker] running: messages, payment reconciliation (every minute), reminders (9am in each user's time zone), housekeeping");

const stop = async () => {
  console.log("[worker] stopping…");
  await b.stop({ graceful: true, timeout: 20_000 });
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
