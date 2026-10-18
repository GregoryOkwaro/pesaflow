import { requireActive } from "@/server/auth/session";
import { body, handler, json } from "@/server/http";
import { budgetPayload, createAccount } from "@/server/services/budgets";
import { accountInput } from "@/server/validation";
import { idParam, type IdCtx } from "@/server/params";

export const POST = handler<IdCtx>(async (req, ctx) => {
  const user = await requireActive();
  const budgetId = await createAccount(user.id, await idParam(ctx), await body(req, accountInput));
  return json(await budgetPayload(user.id, budgetId), 201);
});
