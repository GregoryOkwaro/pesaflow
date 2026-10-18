import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BudgetApp } from "@/components/app/BudgetApp";
import { currentUser } from "@/server/auth/session";
import { env, planList } from "@/server/env";
import { budgetPayload, listBudgets } from "@/server/services/budgets";
import { userJson } from "@/server/services/users";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your budget" };

export default async function AppPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const budgets = await listBudgets(user.id);
  const preferred = (await cookies()).get("pf_budget")?.value;
  const id = budgets.find((b) => b.id === preferred)?.id ?? budgets[0]!.id;
  const initial = await budgetPayload(user.id, id);
  return (
    <Suspense>
      <BudgetApp me={userJson(user)} plans={planList()} mpesaEnv={env().MPESA_ENV} budgets={budgets} initial={initial} />
    </Suspense>
  );
}
