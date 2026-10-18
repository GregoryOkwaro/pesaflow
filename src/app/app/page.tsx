import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BudgetApp } from "@/components/app/BudgetApp";
import { currentUser } from "@/server/auth/session";
import { paymentConfig, planList } from "@/server/env";
import { userToday } from "@/server/services/billing";
import { budgetPayload, listBudgets } from "@/server/services/budgets";
import { userJson } from "@/server/services/users";
import { pricingFor } from "@/server/pricing";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "PesaFlow" } };

export default async function AppPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const budgets = await listBudgets(user.id);
  const preferred = (await cookies()).get("pf_budget")?.value;
  const id = budgets.find((b) => b.id === preferred)?.id ?? budgets[0]!.id;
  const initial = await budgetPayload(user.id, id, userToday(user));
  return (
    <Suspense>
      <BudgetApp me={userJson(user)} plans={planList()} payments={paymentConfig()} pricing={await pricingFor(user.country)} budgets={budgets} initial={initial} />
    </Suspense>
  );
}
