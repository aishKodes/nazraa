import { Card, EmptyState, SectionHeading, StatusBadge } from "@/components/ui";
import { requirePermission } from "@/lib/auth/guard";
import { listRiskFlags } from "@/lib/db/repositories/operations";
import { formatDate } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function RiskPage() {
  const scope = await requirePermission("risk.read");
  const flags = await listRiskFlags(scope);
  return <><SectionHeading title="Risk queue" description="Flags inform review. No automated rule can permanently ban a user on its own." />
    <Card>{flags.length ? <div className="table-scroll"><table><thead><tr><th>Severity</th><th>Flag</th><th>User</th><th>Summary</th><th>Status</th><th>Created</th></tr></thead><tbody>{flags.map((flag) => <tr key={flag.id}><td><StatusBadge value={flag.severity} /></td><td className="mono">{flag.ruleKey}</td><td>{flag.name ? <><b>{flag.name}</b><small className="block mono">{flag.externalUserId}</small></> : "Platform"}</td><td>{flag.summary}</td><td><StatusBadge value={flag.status} /></td><td>{formatDate(flag.createdAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No open risk flags" detail="Risk rules or manual reviewers can create flags here for human investigation." />}</Card>
  </>;
}
