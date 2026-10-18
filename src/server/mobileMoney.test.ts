/** Mobile money outside Kenya (MTN MoMo, Airtel Money, ...) via Flutterwave. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import * as signupRoute from "@/app/api/auth/signup/route";
import * as mobile from "@/app/api/billing/mobile/route";
import * as paymentRoute from "@/app/api/billing/payments/[id]/route";
import * as webhook from "@/app/api/flutterwave/webhook/route";
import * as me from "@/app/api/me/route";
import { addDays, todayIn } from "@/lib/dates";
import { db, schema } from "@/server/db";
import { outbox } from "@/server/notify/channels";
import { signFlutterwavePayload, txRef } from "@/server/payments/flutterwave";
import type { PaymentProvider } from "@/server/payments";
import { pricingFor } from "@/server/pricing";
import { reconcilePending, refresh } from "@/server/services/billing";
import { resetDb, TestClient } from "@/test/client";

const HASH = "flw_test_secret_hash_0123456789";
const TZ = "Africa/Kampala";

async function ugandan(email = "ug@example.com") {
  const c = new TestClient();
  const r = await c.call(signupRoute, "POST", { body: { name: "Okello", email, password: "password123", country: "UG", timezone: TZ } });
  expect(r.status, JSON.stringify(r.data)).toBe(201);
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  return { c, u: u! };
}

/** Starts a mobile money checkout through the API and returns the pending payment row. */
async function start(c: TestClient, plan = "monthly") {
  const r = await c.call(mobile, "POST", { body: { plan } });
  expect(r.status, JSON.stringify(r.data)).toBe(201);
  const [p] = await db.select().from(schema.payments).where(eq(schema.payments.id, r.data.payment.id));
  return { res: r.data, p: p! };
}

const charge = (ref: string, over: Record<string, unknown> = {}) => ({
  event: "charge.completed",
  data: { id: 4_711_001, tx_ref: ref, flw_ref: "FLW-MOCK-1", amount: 11000, charged_amount: 11000, currency: "UGX", status: "successful", processor_response: "Approved", ...over },
});
const send = (body: object, headers: Record<string, string> = { "verif-hash": HASH }) =>
  new TestClient().call(webhook, "POST", { raw: JSON.stringify(body), headers: { "x-requested-with": "", ...headers } });

beforeEach(async () => {
  await resetDb();
  outbox.length = 0;
});

describe("mobile money pricing", () => {
  it("offers MTN MoMo and Airtel Money in local currency where we collect them", async () => {
    const ug = await pricingFor("UG");
    expect(ug.mobileMoney).toEqual({ currency: "UGX", networks: ["MTN MoMo", "Airtel Money"], prices: { monthly: 11000, quarterly: 29000, yearly: 105000 } });
    expect(ug.methods.slice(0, 2)).toEqual(["MTN MoMo", "Airtel Money"]);
    // Two-decimal currencies are stored in minor units.
    expect((await pricingFor("GH")).mobileMoney?.prices.monthly).toBe(4000);
    expect((await pricingFor("KE")).mobileMoney).toBeNull(); // M-Pesa via Daraja instead
    expect((await pricingFor("DE")).mobileMoney).toBeNull();
  });

  it("logged-in Ugandans see it in their pricing; others can't start it", async () => {
    const { c } = await ugandan();
    expect((await c.call(me, "GET")).data.pricing.mobileMoney.currency).toBe("UGX");
    const de = new TestClient();
    await de.call(signupRoute, "POST", { body: { name: "Lena", email: "de@example.com", password: "password123", country: "DE", timezone: "Europe/Berlin" } });
    const r = await de.call(mobile, "POST", { body: { plan: "monthly" } });
    expect(r.status).toBe(400);
    expect(r.data.error).toBe("Mobile money isn't available in your country yet.");
    expect((await c.call(mobile, "POST", { body: { plan: "weekly" } })).status).toBe(400);
  });
});

describe("mobile money checkout (mock)", () => {
  it("creates a pending UGX payment, returns to the app, and extends access once confirmed", async () => {
    const { c, u } = await ugandan();
    const { res, p } = await start(c, "monthly");
    expect(p).toMatchObject({ provider: "flutterwave", status: "pending", amount: 11000, currency: "UGX", providerRef: txRef(p.id) });
    expect(res.redirectUrl).toBe(`http://localhost:3000/app?momo=${p.id}`);

    // Back in the app, the dialog polls; the (mock) status query confirms the exact amount.
    const polled = await c.call(paymentRoute, "GET", { params: { id: p.id } });
    expect(polled.data.payment).toMatchObject({ status: "success", currency: "UGX" });
    expect(polled.data.payment.receipt).toMatch(/^MOCK/);
    expect(polled.data.user.subscription.accessUntil).toBe(addDays(u.trialEndsAt, 30));
    expect(outbox.filter((m) => m.kind === "payment_receipt")).toHaveLength(1);
    expect(outbox.find((m) => m.kind === "payment_receipt")!.text).toContain("Flutterwave MOCK");

    // Polling again changes nothing.
    await c.call(paymentRoute, "GET", { params: { id: p.id } });
    const [after] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
    expect(after!.paidUntil).toBe(addDays(u.trialEndsAt, 30));
  });

  it("the worker reconciles mobile money payments left pending", async () => {
    const { c, u } = await ugandan();
    const { p } = await start(c, "yearly");
    await db.update(schema.payments).set({ createdAt: new Date(Date.now() - 120_000) }).where(eq(schema.payments.id, p.id));
    expect(await reconcilePending()).toBe(1);
    const [after] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
    expect(after!.paidUntil).toBe(addDays(u.trialEndsAt, 365));
  });
});

describe("Flutterwave webhook", () => {
  it("rejects missing, wrong or forged signatures", async () => {
    const { c } = await ugandan();
    const { p } = await start(c);
    const body = charge(p.providerRef!);
    expect((await send(body, {})).status).toBe(401);
    expect((await send(body, { "verif-hash": "guess" })).status).toBe(401);
    expect((await send(body, { "flutterwave-signature": signFlutterwavePayload(JSON.stringify(body), "wrong-secret") })).status).toBe(401);
    const [still] = await db.select().from(schema.payments).where(eq(schema.payments.id, p.id));
    expect(still!.status).toBe("pending");
    // Both signature schemes are accepted with the right secret.
    expect((await send(body, { "flutterwave-signature": signFlutterwavePayload(JSON.stringify(body), HASH) })).status).toBe(200);
    expect((await send(charge("pf_unknown"))).status).toBe(200); // unknown tx_ref: acknowledged, ignored
  });

  it("a successful charge extends access exactly once, even when replayed", async () => {
    const { c, u } = await ugandan();
    await db.update(schema.users).set({ trialEndsAt: addDays(todayIn(TZ), -3) }).where(eq(schema.users.id, u.id));
    const { p } = await start(c, "monthly");
    for (let i = 0; i < 3; i++) expect((await send(charge(p.providerRef!))).status).toBe(200);
    const [paid] = await db.select().from(schema.payments).where(eq(schema.payments.id, p.id));
    expect(paid).toMatchObject({ status: "success", receipt: "4711001", applied: true });
    const [after] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
    // Expired: access runs 30 days from yesterday, never from the old trial end.
    expect(after!.paidUntil).toBe(addDays(todayIn(TZ), 29));
    expect(outbox.filter((m) => m.kind === "payment_receipt")).toHaveLength(1);
  });

  it("an underpaid or wrong-currency charge is not credited", async () => {
    const { c, u } = await ugandan();
    const short = await start(c, "monthly");
    await send(charge(short.p.providerRef!, { amount: 1100 }));
    const [a] = await db.select().from(schema.payments).where(eq(schema.payments.id, short.p.id));
    expect(a).toMatchObject({ status: "failed", applied: false, receipt: null });
    expect(a!.resultDesc).toMatch(/^Amount mismatch: paid 1100 UGX, expected 11000 UGX/);

    const wrong = await start(c, "monthly");
    await send(charge(wrong.p.providerRef!, { id: 4_711_002, currency: "KES" }));
    const [b] = await db.select().from(schema.payments).where(eq(schema.payments.id, wrong.p.id));
    expect(b!.status).toBe("failed");

    const [after] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
    expect(after!.paidUntil).toBeNull();
    expect(outbox.filter((m) => m.kind === "payment_receipt")).toHaveLength(0);
  });

  it("a failed charge fails the payment; a receipt can't be used twice", async () => {
    const { c } = await ugandan();
    const first = await start(c);
    await send(charge(first.p.providerRef!, { status: "failed", processor_response: "Insufficient funds" }));
    const [f] = await db.select().from(schema.payments).where(eq(schema.payments.id, first.p.id));
    expect(f).toMatchObject({ status: "failed", resultDesc: "Insufficient funds" });

    const a = await start(c);
    const b = await start(c);
    await send(charge(a.p.providerRef!, { id: 99 }));
    await send(charge(b.p.providerRef!, { id: 99 }));
    const [pb] = await db.select().from(schema.payments).where(eq(schema.payments.id, b.p.id));
    expect(pb).toMatchObject({ status: "failed", resultDesc: "Duplicate receipt" });
  });

  it("a payment confirmed after we stopped waiting is still credited", async () => {
    const { c, u } = await ugandan();
    const { p } = await start(c);
    const stillWaiting: PaymentProvider = {
      name: "flutterwave",
      startPayment: async () => { throw new Error("unused"); },
      queryStatus: async () => ({ state: "pending", code: "not_found", description: "Not found" }),
      parseCallback: () => null,
    };
    await db.update(schema.payments).set({ createdAt: new Date(Date.now() - 2 * 3_600_000) }).where(eq(schema.payments.id, p.id));
    const timedOut = await refresh((await db.select().from(schema.payments).where(eq(schema.payments.id, p.id)))[0]!, stillWaiting);
    expect(timedOut).toMatchObject({ status: "failed", resultCode: "timeout", resultDesc: "errors.mobileMoneyTimeout" });

    await send(charge(p.providerRef!));
    const [late] = await db.select().from(schema.payments).where(eq(schema.payments.id, p.id));
    expect(late!.status).toBe("success");
    const [after] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
    expect(after!.paidUntil).toBe(addDays(u.trialEndsAt, 30));
  });
});
