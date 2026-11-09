import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import PayoutManagement from "./management";
export default async function Page() {
  const scope = await requirePermission("withdrawals.read");
  const account=scope.account;
  if (!["MASTER", "GLOBAL_MANAGER", "AGENCY", "ADMIN"].includes(account.role)&&!scope.globalManagerId)
    redirect("/dashboard?error=forbidden");
  return <PayoutManagement />;
}
