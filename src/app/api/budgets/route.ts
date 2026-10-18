import { currencyForCountry } from "@/lib/countries";
import { requireActive, requireUser } from "@/server/auth/session";
import { body, handler, json } from "@/server/http";
import { userToday } from "@/server/services/billing";
import { budgetPayload, createBudget, listBudgets } from "@/server/services/budgets";
import { budgetCreateInput } from "@/server/validation";

export const GET = handler(async () => {
  const user = await requireUser();
  return json({ budgets: await listBudgets(user.id) });
});

export const POST = handler(async (req) => {
  const user = await requireActive();
  const { name, copyFrom, currency } = await body(req, budgetCreateInput);
  const b = await createBudget(user.id, name, { copyFrom, currency: currency ?? currencyForCountry(user.country) });
  return json(await budgetPayload(user.id, b.id, userToday(user)), 201);
});
