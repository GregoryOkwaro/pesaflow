/** Request schemas (zod). Money arrives as KES (number or "1,250.50") and leaves here as integer cents. */
import { z } from "zod";
import { isISODate } from "@/lib/dates";
import { parseKes } from "@/lib/money";

const trimmed = (label: string, max: number) =>
  z.string({ error: `${label} is required.` }).trim().max(max, `${label} is too long (max ${max}).`);
const required = (label: string, max: number) => trimmed(label, max).min(1, `${label} is required.`);

export const email = z.string({ error: "Email is required." }).trim().toLowerCase().max(160)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a valid email address.");
export const password = z.string({ error: "Password is required." }).min(8, "Password must be at least 8 characters.").max(200, "Password is too long.");

const kes = (label: string) => z.union([z.number(), z.string()]).transform((v, ctx) => {
  const c = parseKes(v);
  if (c === null) {
    ctx.addIssue({ code: "custom", message: `${label} must be a number, e.g. 2500.` });
    return z.NEVER;
  }
  return c;
});
const isoDate = (label: string) => z.union([z.string(), z.null()]).transform((v, ctx) => {
  if (v === null || v === "") return null;
  if (!isISODate(v)) {
    ctx.addIssue({ code: "custom", message: `${label} must be a date (YYYY-MM-DD).` });
    return z.NEVER;
  }
  return v;
});
const optionalId = z.union([z.uuid(), z.literal(""), z.null()]).transform((v) => v || null);

export const signupInput = z.object({
  name: required("Name", 80),
  email,
  password,
  phone: trimmed("Phone", 20).optional().default(""),
  turnstileToken: z.string().optional(),
});
export const loginInput = z.object({ email, password: z.string().max(200) });
export const resetRequestInput = z.object({ email, turnstileToken: z.string().optional() });
export const resetConfirmInput = z.object({
  email,
  code: z.string().transform((s) => s.replace(/\s/g, "")).pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code.")),
  newPassword: password,
});
export const profileInput = z.object({ name: required("Name", 80).optional(), phone: trimmed("Phone", 20).optional() });
export const changePasswordInput = z.object({ current: z.string().max(200), next: password });

export const budgetCreateInput = z.object({ name: required("Name", 80), copyFrom: z.uuid().optional() });
export const budgetUpdateInput = z.object({
  name: required("Name", 80).optional(),
  horizonDays: z.coerce.number().int().min(7, "Days to project must be 7–120.").max(120, "Days to project must be 7–120.").optional(),
});

// Field definitions without defaults: patches must only touch fields actually sent
// (zod 4 applies .default() even inside .partial(), which would silently reset values).
const accountFields = {
  name: required("Account name", 60),
  details: trimmed("Details", 200),
  balance: kes("Balance"),
  includeInTotal: z.boolean(),
  sort: z.number().int().min(0).max(10_000),
};
export const accountInput = z.object({
  ...accountFields,
  details: accountFields.details.default(""),
  balance: accountFields.balance.default(0),
  includeInTotal: accountFields.includeInTotal.default(true),
  sort: accountFields.sort.default(0),
});
export const accountPatch = z.object(accountFields).partial();

const itemFields = {
  name: required("Item name", 120),
  amount: kes("Amount"),
  everyDays: z.coerce.number().int().min(0, "Every (days) must be 0–366.").max(366, "Every (days) must be 0–366."),
  valueDate: isoDate("Date due"),
  endDate: isoDate("End date"),
  tieTo: optionalId,
  accountId: optionalId,
  done: z.boolean(),
  note: trimmed("Note", 500),
  sort: z.number().int().min(0).max(100_000),
};
export const itemInput = z.object({
  ...itemFields,
  amount: itemFields.amount.default(0),
  everyDays: itemFields.everyDays.default(0),
  valueDate: itemFields.valueDate.default(null),
  endDate: itemFields.endDate.default(null),
  tieTo: itemFields.tieTo.default(null),
  accountId: itemFields.accountId.default(null),
  done: itemFields.done.default(false),
  note: itemFields.note.default(""),
  sort: itemFields.sort.optional(),
});
export const itemPatch = z.object(itemFields).partial();

export const subscribeInput = z.object({ plan: z.string(), phone: z.string().max(20).optional() });
