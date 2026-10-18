/** Delivery channels: ZeptoMail (transactional email) and Africa's Talking (SMS). */
import { env } from "../env";
import { phoneCountry } from "../payments/phone";

export interface Message {
  kind: "reset_code" | "renewal_reminder" | "payment_receipt";
  email?: string;
  name?: string;
  phone?: string | null; // E.164 digits, e.g. 254712345678
  subject: string;
  text: string;
  dir?: "rtl" | "ltr"; // Arabic / Urdu emails render right-to-left
}

/** NOTIFY_ENV=mock: messages land here (and in the log) instead of being sent. */
export const outbox: Message[] = [];

export async function sendEmail(to: string, name: string | undefined, subject: string, text: string, dir: "rtl" | "ltr" = "ltr"): Promise<void> {
  const e = env();
  if (!e.ZEPTOMAIL_TOKEN) throw new Error("ZEPTOMAIL_TOKEN is not set");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#17201a">${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
  const res = await fetch(e.ZEPTOMAIL_API_URL, {
    method: "POST",
    headers: {
      Authorization: e.ZEPTOMAIL_TOKEN.startsWith("Zoho-enczapikey") ? e.ZEPTOMAIL_TOKEN : `Zoho-enczapikey ${e.ZEPTOMAIL_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      from: { address: e.MAIL_FROM_ADDRESS, name: e.MAIL_FROM_NAME },
      to: [{ email_address: { address: to, name: name ?? to } }],
      subject,
      textbody: text,
      htmlbody: html,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`ZeptoMail HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

export async function sendSms(phone: string, text: string): Promise<void> {
  const e = env();
  if (!e.AT_USERNAME || !e.AT_API_KEY) throw new Error("Africa's Talking is not configured");
  const host = e.AT_USERNAME === "sandbox" ? "api.sandbox.africastalking.com" : "api.africastalking.com";
  const form = new URLSearchParams({ username: e.AT_USERNAME, to: `+${phone.replace(/^\+/, "")}`, message: text });
  if (e.AT_SENDER_ID) form.set("from", e.AT_SENDER_ID);
  const res = await fetch(`https://${host}/version1/messaging`, {
    method: "POST",
    headers: { apiKey: e.AT_API_KEY, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as { SMSMessageData?: { Recipients?: { status?: string }[] } };
  const status = data.SMSMessageData?.Recipients?.[0]?.status;
  if (!res.ok || status !== "Success") throw new Error(`SMS not accepted (HTTP ${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
}

/** Africa's Talking covers a set of African countries; everyone else gets email only. */
export function smsSupported(phone: string): boolean {
  const country = phoneCountry(phone);
  return !!country && env().AT_SMS_COUNTRIES.split(",").map((c) => c.trim().toUpperCase()).includes(country);
}

/** Sends on every configured channel. Throws if every attempted channel failed (so the job retries). */
export async function deliver(msg: Message): Promise<void> {
  const e = env();
  if (e.NOTIFY_ENV === "mock") {
    outbox.push(msg);
    if (outbox.length > 100) outbox.splice(0, outbox.length - 100);
    console.log(`[notify:mock] ${msg.kind} to=${msg.email ?? "-"} phone=${msg.phone ?? "-"} :: ${msg.text}`);
    return;
  }
  const attempts: Promise<void>[] = [];
  if (msg.email && e.ZEPTOMAIL_TOKEN) attempts.push(sendEmail(msg.email, msg.name, msg.subject, msg.text, msg.dir));
  if (msg.phone && e.AT_USERNAME && e.AT_API_KEY && smsSupported(msg.phone)) attempts.push(sendSms(msg.phone, msg.text));
  if (!attempts.length) throw new Error("No delivery channel configured (set ZEPTOMAIL_TOKEN and/or AT_USERNAME + AT_API_KEY).");
  const results = await Promise.allSettled(attempts);
  results.forEach((r) => r.status === "rejected" && console.error("[notify]", r.reason));
  if (results.every((r) => r.status === "rejected")) throw new Error("All delivery channels failed");
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
