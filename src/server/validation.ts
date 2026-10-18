/**
 * Request schemas (zod). Messages are i18n keys ("errors.x"), translated in http.ts.
 * Amounts stay as decimal strings here: they're converted to minor units in the
 * services, where the budget's currency (and so its decimal places) is known.
 */
import { z } from "zod";
import { isCountry } from "@/lib/countries";
import { isISODate, isTimeZone } from "@/lib/dates";
import { isCurrency } from "@/lib/money";
import { isLocale } from "@/i18n/translate";

const trimmed = (max: number) => z.string({ error: "errors.required" }).trim().max(max, "errors.tooLong");
const required = (max: number) => trimmed(max).min(1, "errors.required");

export const email = z.string({ error: "errors.required" }).trim().toLowerCase().max(160, "errors.tooLong")
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "errors.emailInvalid");
export const password = z.string({ error: "errors.required" }).min(8, "errors.passwordShort").max(200, "errors.passwordLong");

/** A plain decimal amount ("1250.50", "-300"); per-currency precision is checked in the service. */
const amount = z.union([z.number(), z.string()])
  .transform((v) => String(v).replace(/[,\s  ']/g, ""))
  .pipe(z.string().regex(/^-?\d{1,15}(\.\d{1,3})?$|^$/, "errors.amountInvalid"))
  .transform((s) => s || "0");
const isoDate = z.union([z.string(), z.null()]).transform((v, ctx) => {
  if (v === null || v === "") return null;
  if (!isISODate(v)) {
    ctx.addIssue({ code: "custom", message: "errors.dateInvalid" });
    return z.NEVER;
  }
  return v;
});
const optionalId = z.union([z.uuid(), z.literal(""), z.null()]).transform((v) => v || null);

export const country = z.string().refine(isCountry, "errors.countryInvalid");
export const timezone = z.string().refine(isTimeZone, "errors.timezoneInvalid");
export const locale = z.string().refine(isLocale, "errors.localeInvalid");
export const currency = z.string().toUpperCase().refine(isCurrency, "errors.currencyInvalid");

export const signupInput = z.object({
  name: required(80),
  email,
  password,
  phone: trimmed(24).optional().default(""),
  country: country.optional(),
  timezone: timezone.optional(),
  locale: locale.optional(),
  turnstileToken: z.string().optional(),
});
export const loginInput = z.object({ email, password: z.string().max(200) });
export const resetRequestInput = z.object({ email, turnstileToken: z.string().optional() });
export const resetConfirmInput = z.object({
  email,
  code: z.string().transform((s) => s.replace(/\s/g, "")).pipe(z.string().regex(/^\d{6}$/, "errors.codeFormat")),
  newPassword: password,
});
export const profileInput = z.object({
  name: required(80).optional(),
  phone: trimmed(24).optional(),
  country: country.optional(),
  timezone: timezone.optional(),
  locale: locale.optional(),
});
export const changePasswordInput = z.object({ current: z.string().max(200), next: password });
export const deleteAccountInput = z.object({ password: z.string().min(1, "errors.required").max(200) });

export const budgetCreateInput = z.object({ name: required(80), copyFrom: z.uuid().optional(), currency: currency.optional() });
export const budgetUpdateInput = z.object({
  name: required(80).optional(),
  horizonDays: z.coerce.number().int().min(7, "errors.horizonRange").max(120, "errors.horizonRange").optional(),
  currency: currency.optional(),
});

// Field definitions without defaults: patches must only touch fields actually sent
// (zod 4 applies .default() even inside .partial(), which would silently reset values).
const accountFields = {
  name: required(60),
  details: trimmed(200),
  balance: amount,
  includeInTotal: z.boolean(),
  sort: z.number().int().min(0).max(10_000),
};
export const accountInput = z.object({
  ...accountFields,
  details: accountFields.details.default(""),
  balance: accountFields.balance.default("0"),
  includeInTotal: accountFields.includeInTotal.default(true),
  sort: accountFields.sort.default(0),
});
export const accountPatch = z.object(accountFields).partial();

const itemFields = {
  name: required(120),
  amount,
  everyDays: z.coerce.number().int().min(0, "errors.everyRange").max(366, "errors.everyRange"),
  valueDate: isoDate,
  endDate: isoDate,
  tieTo: optionalId,
  accountId: optionalId,
  done: z.boolean(),
  note: trimmed(500),
  sort: z.number().int().min(0).max(100_000),
};
export const itemInput = z.object({
  ...itemFields,
  amount: itemFields.amount.default("0"),
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

export const subscribeInput = z.object({ plan: z.string(), phone: z.string().max(24).optional() });
export const cardCheckoutInput = z.object({ plan: z.string() });
