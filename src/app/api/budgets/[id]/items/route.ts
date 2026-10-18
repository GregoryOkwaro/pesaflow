import { requireActive } from "@/server/auth/session";
import { body, handler, json } from "@/server/http";
import { userToday } from "@/server/services/billing";
import { budgetPayload, createItem } from "@/server/services/budgets";
import { itemInput } from "@/server/validation";
import { idParam, type IdCtx } from "@/server/params";

export const POST = handler<IdCtx>(async (req, ctx) => {
  const user = await requireActive();
  const budgetId = await createItem(user.id, await idParam(ctx), await body(req, itemInput));
  return json(await budgetPayload(user.id, budgetId, userToday(user)), 201);
});
