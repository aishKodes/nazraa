import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/guard";
import PayoutManagement from "./management";
export default async function Page() {
  const account = await requireSession();
  if (!["MASTER", "AGENCY"].includes(account.role))
    redirect("/dashboard?error=forbidden");
  return <PayoutManagement />;
}
