/** Global launch: regions, currencies, languages, Paddle, GDPR, reminders across time zones. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import * as card from "@/app/api/billing/card/route";
import * as budgetRoute from "@/app/api/budgets/[id]/route";
import * as exportCsv from "@/app/api/budgets/[id]/export/route";
import * as budgetItems from "@/app/api/budgets/[id]/items/route";
import * as budgets from "@/app/api/budgets/route";
import * as localeRoute from "@/app/api/locale/route";
import * as login from "@/app/api/auth/login/route";
import * as me from "@/app/api/me/route";
import * as exportRoute from "@/app/api/me/export/route";
import * as signupRoute from "@/app/api/auth/signup/route";
import * as webhook from "@/app/api/paddle/webhook/route";
import { addDays, todayIn } from "@/lib/dates";
import { db, schema } from "@/server/db";
import { outbox } from "@/server/notify/channels";
import { signPaddlePayload } from "@/server/payments/paddle";
import { sendRenewalReminders } from "@/server/services/reminders";
import { resetDb, TestClient } from "@/test/client";

const SECRET = "pdl_ntfset_test_secret";

async function signup(email: string, extra: Record<string, string> = {}, acceptLanguage = "en") {
  const c = new TestClient(acceptLanguage);
  const r = await c.call(signupRoute, "POST", { body: { name: "Ana", email, password: "password123", ...extra } });
  expect(r.status, JSON.stringify(r.data)).toBe(201);
  return c;
}
const firstBudget = async (c: TestClient) => (await c.call(budgets, "GET")).data.budgets[0];
const userByEmail = async (email: string) => (await db.select().from(schema.users).where(eq(schema.users.email, email)))[0]!;

beforeEach(async () => {
  await resetDb();
  outbox.length = 0;
});

describe("regions, currencies and languages", () => {
  it("a German signup gets EUR, German starter data and German errors", async () => {
    const c = await signup("de@example.com", { country: "DE", timezone: "Europe/Berlin", locale: "de", phone: "0151 23456789" });
    const u = (await c.call(me, "GET")).data.user;
    expect(u).toMatchObject({ country: "DE", timezone: "Europe/Berlin", locale: "de", phone: "4915123456789", defaultCurrency: "EUR" });
    const b = await firstBudget(c);
    expect(b.currency).toBe("EUR");
    expect(b.name).toBe("Mein Monatsbudget");
    const d = (await c.call(budgetRoute, "GET", { params: { id: b.id } })).data;
    expect(d.items.map((i: { name: string }) => i.name)).toContain("Gehalt (Beispiel)");
    // Error messages follow the language cookie set at signup.
    const bad = await c.call(budgetItems, "POST", { params: { id: b.id }, body: { name: "", amount: 1 } });
    expect(bad.status).toBe(400);
    expect(bad.data.error).toBe("Bitte füllen Sie dieses Feld aus.");
  });

  it("logged-out visitors get errors in their browser language", async () => {
    const r = await new TestClient("fr-FR,fr;q=0.9").call(login, "POST", { body: { email: "nobody@example.com", password: "whatever-1" } });
    expect(r.data.error).toBe("E-mail ou mot de passe incorrect.");
    const sw = await new TestClient("sw-KE").call(login, "POST", { body: { email: "nobody@example.com", password: "whatever-1" } });
    expect(sw.data.error).toBe("Barua pepe au nenosiri si sahihi.");
  });

  it("the language switcher saves to the profile", async () => {
    const c = await signup("switch@example.com");
    expect((await c.call(localeRoute, "POST", { body: { locale: "pt" } })).status).toBe(200);
    expect((await userByEmail("switch@example.com")).locale).toBe("pt");
    expect((await c.call(localeRoute, "POST", { body: { locale: "xx" } })).status).toBe(400);
  });

  it("amounts respect each currency's decimals; changing currency keeps values", async () => {
    const c = await signup("jp@example.com", { country: "JP", timezone: "Asia/Tokyo" });
    const b = await firstBudget(c);
    expect(b.currency).toBe("JPY");
    const half = await c.call(budgetItems, "POST", { params: { id: b.id }, body: { name: "Lunch", amount: "-1500.5" } });
    expect(half.status).toBe(400);
    expect(half.data.code).toBe("errors.amountDecimals");
    const ok = await c.call(budgetItems, "POST", { params: { id: b.id }, body: { name: "Lunch", amount: "-1500" } });
    expect(ok.data.items.find((i: { name: string }) => i.name === "Lunch").amount).toBe(-1500);
    // JPY -> USD: 1500 yen-units become 1500.00 dollars (relabel, not convert), i.e. 150000 cents.
    const usd = (await c.call(budgetRoute, "PUT", { params: { id: b.id }, body: { currency: "USD" } })).data;
    expect(usd.budget.currency).toBe("USD");
    expect(usd.items.find((i: { name: string }) => i.name === "Lunch").amount).toBe(-150000);
    const csv = String((await c.call(exportCsv, "GET", { params: { id: b.id } })).data);
    expect(csv).toContain("(USD)");
    expect(csv).toContain("-1500");
  });

  it("'today' is the user's own date, not the server's", async () => {
    const c = await signup("nz@example.com", { country: "NZ", timezone: "Pacific/Kiritimati" }); // UTC+14
    const b = await firstBudget(c);
    const d = (await c.call(budgetRoute, "GET", { params: { id: b.id } })).data;
    expect(d.projection.today).toBe(todayIn("Pacific/Kiritimati"));
  });

  it("rejects unknown countries, zones and currencies", async () => {
    const r = await new TestClient().call(signupRoute, "POST", { body: { name: "X", email: "x@example.com", password: "password123", country: "ZZ" } });
    expect(r.data.code).toBe("errors.countryInvalid");
    const c = await signup("tz@example.com");
    expect((await c.call(me, "PUT", { body: { timezone: "Mars/Base" } })).data.code).toBe("errors.timezoneInvalid");
    const b = await firstBudget(c);
    expect((await c.call(budgetRoute, "PUT", { params: { id: b.id }, body: { currency: "ABC" } })).data.code).toBe("errors.currencyInvalid");
  });
});

describe("Paddle (cards, PayPal, local methods)", () => {
  const send = (body: object, sig?: string) => {
    const raw = JSON.stringify(body);
    return new TestClient().call(webhook, "POST", { raw, headers: { "paddle-signature": sig ?? signPaddlePayload(raw, SECRET), "x-requested-with": "" } });
  };
  const txn = (userId: string, id = "txn_01", endsAt = new Date(Date.now() + 30 * 86_400_000).toISOString()) => ({
    event_id: `evt_${id}`, event_type: "transaction.completed", occurred_at: new Date().toISOString(),
    data: { id, status: "completed", customer_id: "ctm_1", subscription_id: "sub_1", custom_data: { userId, plan: "monthly" },
      currency_code: "EUR", details: { totals: { grand_total: "357" } }, billing_period: { ends_at: endsAt } },
  });

  it("rejects bad or stale signatures", async () => {
    const u = await (async () => { await signup("sig@example.com"); return userByEmail("sig@example.com"); })();
    expect((await send(txn(u.id), "ts=1;h1=deadbeef")).status).toBe(401);
    const raw = JSON.stringify(txn(u.id));
    const stale = signPaddlePayload(raw, SECRET, Math.floor(Date.now() / 1000) - 3600);
    expect((await new TestClient().call(webhook, "POST", { raw, headers: { "paddle-signature": stale } })).status).toBe(401);
  });

  it("a completed transaction extends access once, even when replayed", async () => {
    await signup("card@example.com", { country: "FR", timezone: "Europe/Paris", locale: "fr" });
    const u = await userByEmail("card@example.com");
    await db.update(schema.users).set({ trialEndsAt: addDays(todayIn("Europe/Paris"), -1) }).where(eq(schema.users.id, u.id));
    const ends = new Date(Date.now() + 30 * 86_400_000).toISOString();
    expect((await send(txn(u.id, "txn_A", ends))).status).toBe(200);
    expect((await send(txn(u.id, "txn_A", ends))).status).toBe(200);
    const after = await userByEmail("card@example.com");
    expect(after.paidUntil).toBe(todayIn("Europe/Paris", new Date(ends)));
    expect(after.paddleSubscriptionId).toBe("sub_1");
    const pays = await db.select().from(schema.payments).where(eq(schema.payments.userId, u.id));
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ provider: "paddle", amount: 357, currency: "EUR", status: "success" });
    const receipt = outbox.find((m) => m.kind === "payment_receipt")!;
    expect(receipt.text).toMatch(/^Bonjour Ana, nous avons reçu 3,57\s?EUR/);
  });

  it("subscription updates track status and never shorten access", async () => {
    await signup("sub@example.com");
    const u = await userByEmail("sub@example.com");
    const far = new Date(Date.now() + 60 * 86_400_000).toISOString();
    const sub = (status: string, endsAt: string, scheduled: object | null = null) => ({
      event_id: `evt_${status}`, event_type: "subscription.updated", occurred_at: new Date().toISOString(),
      data: { id: "sub_9", status, customer_id: "ctm_9", custom_data: { userId: u.id }, current_billing_period: { ends_at: endsAt },
        scheduled_change: scheduled, management_urls: { update_payment_method: "https://pay.example/update", cancel: "https://pay.example/cancel" } },
    });
    await send(sub("active", far));
    let row = await userByEmail("sub@example.com");
    expect(row.paddleSubscriptionStatus).toBe("active");
    expect(row.paddleCancelUrl).toBe("https://pay.example/cancel");
    const farDate = row.paidUntil;
    await send(sub("active", new Date(Date.now() + 5 * 86_400_000).toISOString(), { action: "cancel" }));
    row = await userByEmail("sub@example.com");
    expect(row.paddleSubscriptionStatus).toBe("canceled");
    expect(row.paidUntil).toBe(farDate);
  });

  it("mock card checkout activates a subscription and blocks a second one", async () => {
    const c = await signup("mockcard@example.com", { country: "US", timezone: "America/New_York" });
    const r = await c.call(card, "POST", { body: { plan: "yearly" } });
    expect(r.status).toBe(200);
    expect(r.data.user.card.status).toBe("active");
    expect(r.data.user.subscription.onTrial).toBe(false);
    expect((await c.call(card, "POST", { body: { plan: "monthly" } })).data.code).toBe("errors.cardSubscriptionActive");
  });
});

describe("GDPR: access and erasure", () => {
  it("exports the user's data without secrets", async () => {
    const c = await signup("gdpr@example.com");
    const r = await c.call(exportRoute, "GET");
    expect(r.status).toBe(200);
    expect(r.data.profile.email).toBe("gdpr@example.com");
    expect(r.data.profile.passwordHash).toBeUndefined();
    expect(r.data.budgets[0].items.length).toBe(3);
  });

  it("deletes the account and everything in it, only with the password", async () => {
    const c = await signup("bye@example.com");
    const u = await userByEmail("bye@example.com");
    expect((await c.call(me, "DELETE", { body: { password: "wrong-password" } })).status).toBe(400);
    expect((await c.call(me, "DELETE", { body: { password: "password123" } })).status).toBe(200);
    expect(await db.select().from(schema.users).where(eq(schema.users.id, u.id))).toHaveLength(0);
    expect(await db.select().from(schema.budgets).where(eq(schema.budgets.userId, u.id))).toHaveLength(0);
    expect((await c.call(me, "GET")).status).toBe(401);
  });
});

describe("renewal reminders across time zones", () => {
  it("reminds each user at 9am their time, in their language; SMS only where supported", async () => {
    await signup("tokyo@example.com", { country: "JP", timezone: "Asia/Tokyo", locale: "en", phone: "090-1234-5678" });
    await signup("lagos@example.com", { country: "NG", timezone: "Africa/Lagos", locale: "fr", phone: "0803 123 4567" });
    for (const email of ["tokyo@example.com", "lagos@example.com"]) {
      const u = await userByEmail(email);
      await db.update(schema.users).set({ trialEndsAt: addDays(todayIn(u.timezone), 1) }).where(eq(schema.users.id, u.id));
    }
    // 00:00 UTC = 09:00 in Tokyo, 01:00 in Lagos.
    const at = new Date(); at.setUTCHours(0, 0, 0, 0);
    expect(await sendRenewalReminders({ now: at })).toBe(1);
    expect(outbox.at(-1)!.email).toBe("tokyo@example.com");
    // 08:00 UTC = 09:00 in Lagos.
    const lagos = new Date(at.getTime() + 8 * 3_600_000);
    expect(await sendRenewalReminders({ now: lagos })).toBe(1);
    const msg = outbox.at(-1)!;
    expect(msg.email).toBe("lagos@example.com");
    expect(msg.subject).toMatch(/^Votre essai gratuit PesaFlow se termine/);
  });
});
