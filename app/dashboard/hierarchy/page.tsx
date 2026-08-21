import { Network } from "lucide-react";
import { Card, EmptyState, SectionHeading } from "@/components/ui";
import { HierarchyTree } from "@/components/hierarchy-tree";
import { requirePermission } from "@/lib/auth/guard";
import { hierarchy } from "@/lib/db/repositories/directory";

export const dynamic = "force-dynamic";

export default async function HierarchyPage() {
  const scope = await requirePermission("hierarchy.read");
  const accounts = await hierarchy(scope);
  return <><SectionHeading title="Hierarchy" description="Master → Super Admin → Admin → Agency → Host, with branch-restricted 30-day performance." action={<span className="scope-lock"><Network size={15} />{scope.isGlobal ? "Global view" : "Your branch only"}</span>} />
    <Card>{accounts.length ? <HierarchyTree nodes={accounts} /> : <EmptyState title="No accounts visible" detail="Accounts created under this branch will appear here." />}</Card>
  </>;
}
