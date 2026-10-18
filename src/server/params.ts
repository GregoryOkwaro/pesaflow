import { z } from "zod";
import { ApiError } from "./http";

export type IdCtx = { params: Promise<{ id: string }> };

/** Route param as a UUID; anything else is simply "not found". */
export async function idParam(ctx: IdCtx): Promise<string> {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "errors.notFound");
  return id;
}
