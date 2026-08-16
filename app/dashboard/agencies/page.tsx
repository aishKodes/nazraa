import { Building2, LockKeyhole } from "lucide-react";
import { Card, EmptyState, SectionHeading, StatusBadge } from "@/components/ui";
import { requirePermission } from "@/lib/auth/guard";
import { listAgencies } from "@/lib/db/repositories/directory";

export const dynamic = "force-dynamic";

export default async function AgenciesPage() {
  const scope = await requirePermission("agencies.read");
  const agencies = await listAgencies(scope);
  return <>
    <SectionHeading title="Agencies" description="Agency access stays inside its assigned branch. Parent relationships are set on the server, never in the browser." action={scope.account.role === "ADMIN" ? <span className="soft-action"><Building2 size={16} />Create agency</span> : <span className="scope-lock"><LockKeyhole size={14} />Scoped view</span>} />
    <Card>{agencies.length ? <div className="table-scroll"><table><thead><tr><th>Agency</th><th>Code</th><th>Country</th><th>Managed by</th><th className="align-right">Hosts</th><th>Status</th></tr></thead><tbody>{agencies.map((agency) => <tr key={agency.id}><td><b>{agency.name}</b></td><td className="mono">{agency.code}</td><td>{agency.country ?? "—"}</td><td>{agency.owner ?? "Master"}</td><td className="align-right">{agency.hostCount}</td><td><StatusBadge value={agency.status} /></td></tr>)}</tbody></table></div> : <EmptyState title="No agencies in this branch" detail="New agencies will automatically inherit their Admin and Super Admin scope." />}</Card>
  </>;
}
