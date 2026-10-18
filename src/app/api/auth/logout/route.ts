import { endSession } from "@/server/auth/session";
import { handler, json } from "@/server/http";

export const POST = handler(async () => {
  await endSession();
  return json({ ok: true });
});
