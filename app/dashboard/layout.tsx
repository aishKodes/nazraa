import { AppShell } from "@/components/shell";
import { requireSession } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const account = await requireSession();
  return <AppShell account={account}>{children}</AppShell>;
}
