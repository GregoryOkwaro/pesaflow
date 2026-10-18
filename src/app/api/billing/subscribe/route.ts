import { requireUser } from "@/server/auth/session";
import { body, handler, json } from "@/server/http";
import { enforce } from "@/server/rateLimit";
import { paymentJson, startPayment } from "@/server/services/billing";
import { subscribeInput } from "@/server/validation";

export const POST = handler(async (req) => {
  const user = await requireUser();
  await enforce(`pay:${user.id}`, 5, 600, "errors.ratePay");
  const { plan, phone } = await body(req, subscribeInput);
  const { payment } = await startPayment(user, plan, phone || user.phone || "");
  return json({ payment: paymentJson(payment) }, 201);
});
