import { requireUser } from "@/server/auth/session";
import { body, handler, json } from "@/server/http";
import { enforce } from "@/server/rateLimit";
import { paymentJson, startPayment } from "@/server/services/billing";
import { subscribeInput } from "@/server/validation";

export const POST = handler(async (req) => {
  const user = await requireUser();
  await enforce(`pay:${user.id}`, 5, 600, "Too many payment attempts. Wait a few minutes.");
  const { plan, phone } = await body(req, subscribeInput);
  const { payment, message } = await startPayment(user, plan, phone || user.phone || "");
  return json({ payment: paymentJson(payment), message }, 201);
});
