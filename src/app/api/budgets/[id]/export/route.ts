import { requireUser } from "@/server/auth/session";
import { handler } from "@/server/http";
import { budgetPayload, toCsv } from "@/server/services/budgets";
import { idParam, type IdCtx } from "@/server/params";

export const GET = handler<IdCtx>(async (_req, ctx) => {
  const user = await requireUser();
  const p = await budgetPayload(user.id, await idParam(ctx));
  const name = p.budget.name.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40) || "budget";
  return new Response(toCsv(p), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}_${p.projection.today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
