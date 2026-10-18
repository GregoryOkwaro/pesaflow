import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { env, paddlePriceId, PLAN_DAYS, planList, type PlanKey } from "@/server/env";
import { ApiError, body, handler, json } from "@/server/http";
import { enforce } from "@/server/rateLimit";
import { assertCanStartCardCheckout, handlePaddleEvent } from "@/server/services/billing";
import { userJson } from "@/server/services/users";
import { cardCheckoutInput } from "@/server/validation";

/**
 * Prepares a Paddle checkout. The browser opens Paddle.js with the returned price
 * and customData; Paddle then reports the result to our webhook. In PADDLE_ENV=mock
 * the purchase is simulated right here through the same webhook handler.
 */
export const POST = handler(async (req) => {
  const user = await requireUser();
  await enforce(`card:${user.id}`, 10, 600, "errors.ratePay");
  const { plan } = await body(req, cardCheckoutInput);
  assertCanStartCardCheckout(user, plan);
  const key = plan as PlanKey;

  if (env().PADDLE_ENV === "mock") {
    const id = randomBytes(6).toString("hex");
    const ends = new Date(Date.now() + PLAN_DAYS[key] * 86_400_000).toISOString();
    const custom = { userId: user.id, plan: key };
    await handlePaddleEvent({ event_id: `evt_mock_${id}`, event_type: "subscription.created", occurred_at: new Date().toISOString(), data: {
      id: `sub_mock_${id}`, status: "active", customer_id: `ctm_mock_${user.id.slice(-8)}`, custom_data: custom,
      current_billing_period: { ends_at: ends }, management_urls: { update_payment_method: null, cancel: null },
    } });
    await handlePaddleEvent({ event_id: `evt_mock_${id}_t`, event_type: "transaction.completed", occurred_at: new Date().toISOString(), data: {
      id: `txn_mock_${id}`, status: "completed", customer_id: `ctm_mock_${user.id.slice(-8)}`, subscription_id: `sub_mock_${id}`,
      custom_data: custom, currency_code: "USD", details: { totals: { grand_total: String(planList().find((p) => p.key === key)!.usd) } },
      billing_period: { ends_at: ends },
    } });
    const [fresh] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    return json({ mode: "mock", user: userJson(fresh!) });
  }

  const priceId = paddlePriceId(key);
  if (!priceId) throw new ApiError(503, "errors.cardUnavailable");
  return json({
    mode: env().PADDLE_ENV,
    priceId,
    customer: user.paddleCustomerId ? { id: user.paddleCustomerId } : { email: user.email },
    customData: { userId: user.id, plan: key },
  });
});
