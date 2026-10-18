import { requireActive } from "@/server/auth/session";
import { body, handler, json } from "@/server/http";
import { idParam, type IdCtx } from "@/server/params";
import { budgetPayload, deleteItem, updateItem } from "@/server/services/budgets";
import { itemPatch } from "@/server/validation";

export const PUT = handler<IdCtx>(async (req, ctx) => {
  const user = await requireActive();
  const budgetId = await updateItem(user.id, await idParam(ctx), await body(req, itemPatch));
  return json(await budgetPayload(user.id, budgetId));
});

export const DELETE = handler<IdCtx>(async (_req, ctx) => {
  const user = await requireActive();
  const budgetId = await deleteItem(user.id, await idParam(ctx));
  return json(await budgetPayload(user.id, budgetId));
});
