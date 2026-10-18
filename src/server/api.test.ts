/** End-to-end tests through the real route handlers against Postgres 18 (pesaflow_test). */
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import * as accountRoute from "@/app/api/accounts/[id]/route";
import * as login from "@/app/api/auth/login/route";
import * as logout from "@/app/api/auth/logout/route";
import * as resetConfirm from "@/app/api/auth/reset/confirm/route";
import * as resetRequest from "@/app/api/auth/reset/request/route";
import * as signupRoute from "@/app/api/auth/signup/route";
import * as paymentStatus from "@/app/api/billing/payments/[id]/route";
import * as subscribe from "@/app/api/billing/subscribe/route";
import * as budgetRoute from "@/app/api/budgets/[id]/route";
import * as exportRoute from "@/app/api/budgets/[id]/export/route";
import * as budgetItems from "@/app/api/budgets/[id]/items/route";
import * as budgets from "@/app/api/budgets/route";
import * as itemRoute from "@/app/api/items/[id]/route";
import * as me from "@/app/api/me/route";
import * as callback from "@/app/api/mpesa/callback/[secret]/route";
import { addDays, todayInNairobi } from "@/lib/dates";
import { db, schema } from "@/server/db";
import { outbox } from "@/server/notify/channels";
import { sendRenewalReminders } from "@/server/services/reminders";
import { resetDb, TestClient } from "@/test/client";

async function signup(email: string, password = "password123") {
  const c = new TestClient();
  const r = await c.call(signupRoute, "POST", { body: { name: "Test", email, password, phone: "0712345678" } });
  expect(r.status, JSON.stringify(r.data)).toBe(201);
  return c;
}
const firstBudget = async (c: TestClient) => (await c.call(budgets, "GET")).data.budgets[0].id as string;
const expire = (email: string) =>
  db.update(schema.users).set({ trialEndsAt: addDays(todayInNairobi(), -1), paidUntil: null }).where(eq(schema.users.email, email));

beforeEach(async () => {
  await resetDb();
  outbox.length = 0;
});

describe("auth", () => {
  it("signup seeds a budget with a 31-day projection", async () => {
    const c = await signup("a@example.com");
    const b = await c.call(budgetRoute, "GET", { params: { id: await firstBudget(c) } });
    expect(b.data.projection.days).toHaveLength(31);
    expect(b.data.items).toHaveLength(3);
    expect((await c.call(me, "GET")).data.user.subscription.daysLeft).toBe(14);
  });

  it("rejects duplicate emails (case-insensitive) and wrong passwords", async () => {
    await signup("dup@example.com");
    expect((await new TestClient().call(signupRoute, "POST", { body: { name: "x", email: "DUP@example.com", password: "password123" } })).status).toBe(409);
    expect((await new TestClient().call(login, "POST", { body: { email: "dup@example.com", password: "wrong-pass" } })).status).toBe(401);
    expect((await new TestClient().call(login, "POST", { body: { email: "Dup@Example.com", password: "password123" } })).status).toBe(200);
  });

  it("logout ends the session", async () => {
    const c = await signup("out@example.com");
    const token = c.session;
    await c.call(logout, "POST");
    const again = new TestClient(); again.session = token;
    expect((await again.call(me, "GET")).status).toBe(401);
  });

  it("blocks state-changing requests without the CSRF header or from another site", async () => {
    const c = await signup("csrf@example.com");
    expect((await c.call(budgets, "POST", { body: { name: "x" }, headers: { "x-requested-with": "" } })).status).toBe(403);
    expect((await c.call(budgets, "POST", { body: { name: "x" }, headers: { origin: "https://evil.example" } })).status).toBe(403);
  });
});

describe("budgets", () => {
  it("item CRUD drives the projection; partial edits keep other fields", async () => {
    const c = await signup("crud@example.com");
    const id = await firstBudget(c);
    let d = (await c.call(budgetRoute, "GET", { params: { id } })).data;
    d = (await c.call(accountRoute, "PUT", { params: { id: d.accounts[0].id }, body: { balance: "1,000.50" } })).data;
    expect(d.projection.openingBalance).toBe(100050);
    for (const i of d.items) await c.call(itemRoute, "DELETE", { params: { id: i.id } });
    const r = await c.call(budgetItems, "POST", { params: { id }, body: { name: "Lunch", amount: -100, everyDays: 1, valueDate: todayInNairobi() } });
    expect(r.status).toBe(201);
    expect(r.data.projection.closingBalance).toBe(100050 - 310000);
    const item = r.data.items[0];
    d = (await c.call(itemRoute, "PUT", { params: { id: item.id }, body: { done: true } })).data;
    expect(d.items[0].amount).toBe(-10000); // zod defaults must not reset untouched fields
    expect(d.items[0].everyDays).toBe(1);
    expect(d.projection.closingBalance).toBe(100050);
    expect((await c.call(itemRoute, "PUT", { params: { id: item.id }, body: { tieTo: item.id } })).status).toBe(400);
    expect((await c.call(itemRoute, "PUT", { params: { id: item.id }, body: { amount: "12abc" } })).status).toBe(400);
    const csv = await c.call(exportRoute, "GET", { params: { id } });
    expect(csv.status).toBe(200);
    expect(String(csv.data)).toContain("Cumulative balance");
  });

  it("copying a budget remaps accounts and ties", async () => {
    const c = await signup("copy@example.com");
    const id = await firstBudget(c);
    const copy = (await c.call(budgets, "POST", { body: { name: "Next month", copyFrom: id } })).data;
    const rent = copy.items.find((i: { name: string }) => i.name.startsWith("Rent"));
    const salary = copy.items.find((i: { name: string }) => i.name.startsWith("Salary"));
    expect(rent.tieTo).toBe(salary.id);
    expect(copy.accounts.map((a: { id: string }) => a.id)).toContain(rent.accountId);
  });

  it("users cannot see or touch each other's data", async () => {
    const a = await signup("owner@example.com");
    const b = await signup("intruder@example.com");
    const id = await firstBudget(a);
    const item = (await a.call(budgetRoute, "GET", { params: { id } })).data.items[0].id;
    expect((await b.call(budgetRoute, "GET", { params: { id } })).status).toBe(404);
    expect((await b.call(itemRoute, "PUT", { params: { id: item }, body: { name: "pwned" } })).status).toBe(404);
    expect((await b.call(budgetItems, "POST", { params: { id }, body: { name: "x" } })).status).toBe(404);
    expect((await b.call(budgets, "POST", { body: { name: "x", copyFrom: id } })).status).toBe(404);
    expect((await b.call(budgetRoute, "GET", { params: { id: "not-a-uuid" } })).status).toBe(404);
  });
});

describe("billing", () => {
  it("expired accounts are read-only until paid; mock M-Pesa unlocks 30 days", async () => {
    const c = await signup("pay@example.com");
    await expire("pay@example.com");
    const id = await firstBudget(c);
    expect((await c.call(budgetItems, "POST", { params: { id }, body: { name: "x", amount: -1 } })).status).toBe(402);
    expect((await c.call(budgetRoute, "GET", { params: { id } })).status).toBe(200);
    const s = await c.call(subscribe, "POST", { body: { plan: "monthly", phone: "+254 712 345 678" } });
    expect(s.status).toBe(201);
    expect(s.data.payment.phone).toBe("254712345678");
    const st = await c.call(paymentStatus, "GET", { params: { id: s.data.payment.id } });
    expect(st.data.payment.status).toBe("success");
    expect(st.data.user.subscription.daysLeft).toBe(30);
    expect((await c.call(budgetItems, "POST", { params: { id }, body: { name: "x", amount: -1 } })).status).toBe(201);
    expect(outbox.some((m) => m.kind === "payment_receipt")).toBe(true);
  });

  it("Daraja callback: wrong secret, underpayment, success applied once", async () => {
    const c = await signup("cb@example.com");
    await expire("cb@example.com");
    const ref = async () => {
      const r = await c.call(subscribe, "POST", { body: { plan: "yearly", phone: "0712345678" } });
      const [p] = await db.select().from(schema.payments).where(eq(schema.payments.id, r.data.payment.id));
      return p!.providerRef!;
    };
    const cb = (checkout: string, code: number, amount: number, receipt: string) => ({ Body: { stkCallback: {
      MerchantRequestID: "m", CheckoutRequestID: checkout, ResultCode: code, ResultDesc: "ok",
      CallbackMetadata: { Item: [{ Name: "Amount", Value: amount }, { Name: "MpesaReceiptNumber", Value: receipt }, { Name: "PhoneNumber", Value: 254712345678 }] } } } });
    const anon = new TestClient();
    const first = await ref();
    expect((await anon.call(callback, "POST", { params: { secret: "wrong" }, body: cb(first, 0, 2999, "R1") })).status).toBe(404);
    // No CSRF header needed for Safaricom's server-to-server call.
    expect((await anon.call(callback, "POST", { params: { secret: "test-callback-secret-0123456789" }, body: cb(first, 0, 1, "R1"), headers: { "x-requested-with": "" } })).status).toBe(200);
    const [under] = await db.select().from(schema.payments).where(eq(schema.payments.providerRef, first));
    expect(under!.status).toBe("failed");
    expect(under!.resultDesc).toContain("Amount mismatch");

    const second = await ref();
    for (let i = 0; i < 2; i++) await anon.call(callback, "POST", { params: { secret: "test-callback-secret-0123456789" }, body: cb(second, 0, 2999, "R2") });
    expect((await c.call(me, "GET")).data.user.subscription.daysLeft).toBe(365);
  });

  it("concurrent callback + status query still extend access only once", async () => {
    const c = await signup("race@example.com");
    await expire("race@example.com");
    const r = await c.call(subscribe, "POST", { body: { plan: "monthly", phone: "0712345678" } });
    const [p] = await db.select().from(schema.payments).where(eq(schema.payments.id, r.data.payment.id));
    const body = { Body: { stkCallback: { CheckoutRequestID: p!.providerRef, ResultCode: 0, ResultDesc: "ok",
      CallbackMetadata: { Item: [{ Name: "Amount", Value: 299 }, { Name: "MpesaReceiptNumber", Value: "RACE1" }] } } } };
    await Promise.all([
      new TestClient().call(callback, "POST", { params: { secret: "test-callback-secret-0123456789" }, body }),
      c.call(paymentStatus, "GET", { params: { id: p!.id } }),
      c.call(paymentStatus, "GET", { params: { id: p!.id } }),
    ]);
    expect((await c.call(me, "GET")).data.user.subscription.daysLeft).toBe(30);
  });
});

describe("password reset", () => {
  const request = async (email: string) => {
    const before = outbox.length;
    const r = await new TestClient().call(resetRequest, "POST", { body: { email } });
    expect(r.status).toBe(200);
    const msg = outbox.length > before ? outbox.at(-1)! : null;
    return { data: r.data, code: msg?.text.match(/\b(\d{6})\b/)?.[1] ?? null };
  };
  const confirm = (c: TestClient, email: string, code: string, newPassword = "brand-new-pass") =>
    c.call(resetConfirm, "POST", { body: { email, code, newPassword } });

  it("unknown emails get the identical reply and nothing is sent", async () => {
    await signup("known@example.com");
    const known = await request("known@example.com");
    const unknown = await request("nobody@example.com");
    expect(known.data).toEqual(unknown.data);
    expect(known.code).toMatch(/^\d{6}$/);
    expect(unknown.code).toBeNull();
    expect((await confirm(new TestClient(), "nobody@example.com", "123456")).status).toBe(400);
  });

  it("a valid code resets the password, logs in, and signs out other devices", async () => {
    const old = await signup("reset@example.com");
    const { code } = await request("reset@example.com");
    const fresh = new TestClient();
    expect((await confirm(fresh, "reset@example.com", `${code!.slice(0, 3)} ${code!.slice(3)}`)).status).toBe(200);
    expect((await fresh.call(me, "GET")).status).toBe(200);
    expect((await old.call(me, "GET")).status).toBe(401);
    expect((await new TestClient().call(login, "POST", { body: { email: "reset@example.com", password: "password123" } })).status).toBe(401);
    expect((await new TestClient().call(login, "POST", { body: { email: "reset@example.com", password: "brand-new-pass" } })).status).toBe(200);
    expect((await confirm(new TestClient(), "reset@example.com", code!)).status).toBe(400); // single use
  });

  it("wrong guesses use up attempts; expired codes are refused", async () => {
    await signup("brute@example.com");
    const { code } = await request("brute@example.com");
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await confirm(new TestClient(), "brute@example.com", wrong)).status).toBe(400);
    expect((await confirm(new TestClient(), "brute@example.com", code!)).status).toBe(400);

    const second = await request("brute@example.com");
    await db.execute(sql`UPDATE password_resets SET expires_at = now() - interval '1 minute'`);
    expect((await confirm(new TestClient(), "brute@example.com", second.code!)).status).toBe(400);
  });
});

describe("renewal reminders", () => {
  it("reminds once per access period, by email and SMS", async () => {
    await signup("remind@example.com");
    await db.update(schema.users).set({ trialEndsAt: addDays(todayInNairobi(), 1) }).where(eq(schema.users.email, "remind@example.com"));
    expect(await sendRenewalReminders()).toBe(1);
    expect(await sendRenewalReminders()).toBe(0);
    const msg = outbox.find((m) => m.kind === "renewal_reminder")!;
    expect(msg.phone).toBe("254712345678");
    expect(msg.subject).toContain("free trial");
  });
});
