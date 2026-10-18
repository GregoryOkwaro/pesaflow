import { requireUser } from "@/server/auth/session";
import { handler } from "@/server/http";
import { exportUserData } from "@/server/services/users";

/** GDPR access/portability: everything we hold about the signed-in user, as a JSON download. */
export const GET = handler(async () => {
  const user = await requireUser();
  const data = await exportUserData(user);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="pesaflow-data-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
});
