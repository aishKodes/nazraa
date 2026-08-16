import { Network } from "lucide-react";
import { Card, EmptyState, SectionHeading, StatusBadge } from "@/components/ui";
import { requirePermission } from "@/lib/auth/guard";
import { hierarchy } from "@/lib/db/repositories/directory";

export const dynamic = "force-dynamic";

export default async function HierarchyPage() {
  const scope = await requirePermission("hierarchy.read");
  const accounts = await hierarchy(scope);
  const levelFor = (account: (typeof accounts)[number]) => {
    let level = 0; let parent = account.parentId;
    while (parent) { level += 1; parent = accounts.find((entry) => entry.id === parent)?.parentId ?? null; }
    return level;
  };
  return <><SectionHeading title="Hierarchy" description="A simple accountable chain: Master → Super Admin → Admin → Agency. Data follows this structure." action={<span className="scope-lock"><Network size={15} />{scope.isGlobal ? "Global view" : "Your branch"}</span>} />
    <Card>{accounts.length ? <div className="hierarchy-list">{accounts.map((account) => <div className="hierarchy-row" key={account.id} style={{ paddingLeft: `${20 + levelFor(account) * 34}px` }}><span className="tree-line" /><span className="role-dot" /><div><b>{account.name}</b><small>{account.role.replaceAll("_", " ")} · <span className="mono">{account.code}</span></small></div><StatusBadge value={account.status} /></div>)}</div> : <EmptyState title="No accounts visible" detail="Accounts created under this branch will appear here." />}</Card>
  </>;
}
