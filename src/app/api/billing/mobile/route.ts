import { requireUser } from "@/server/auth/session";
import { body, handler, json } from "@/server/http";
import { enforce } from "@/server/rateLimit";
import { paymentJson, startMobileMoney } from "@/server/services/billing";
import { cardCheckoutInput } from "@/server/validation";

/**
 * Starts a mobile money payment (MTN MoMo, Airtel Money, ...) in the user's local
 * currency. The browser goes to `redirectUrl` (Flutterwave's hosted checkout; in
 * mock mode straight back to the app), which returns to /app?momo=<payment id>.
 */
export const POST = handler(async (req) => {
  const user = await requireUser();
  await enforce(`pay:${user.id}`, 5, 600, "errors.ratePay");
  const { plan } = await body(req, cardCheckoutInput);
  const { payment, redirectUrl } = await startMobileMoney(user, plan);
  return json({ payment: paymentJson(payment), redirectUrl }, 201);
});
