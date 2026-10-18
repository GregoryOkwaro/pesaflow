import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await currentUser()) redirect("/app");
  return children;
}
