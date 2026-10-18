import { requireActive, requireUser } from "@/server/auth/session";
import { body, handler, json } from "@/server/http";
import { idParam, type IdCtx as Ctx } from "@/server/params";
import { budgetPayload, deleteBudget, updateBudget } from "@/server/services/budgets";
import { budgetUpdateInput } from "@/server/validation";

export const GET = handler<Ctx>(async (_req, ctx) => {
  const user = await requireUser();
  return json(await budgetPayload(user.id, await idParam(ctx)));
});

export const PUT = handler<Ctx>(async (req, ctx) => {
  const user = await requireActive();
  const id = await idParam(ctx);
  await updateBudget(user.id, id, await body(req, budgetUpdateInput));
  return json(await budgetPayload(user.id, id));
});

export const DELETE = handler<Ctx>(async (_req, ctx) => {
  const user = await requireUser();
  await deleteBudget(user.id, await idParam(ctx));
  return json({ ok: true });
});
