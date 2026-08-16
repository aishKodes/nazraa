import { Card, EmptyState, SectionHeading } from "@/components/ui";
import { requirePermission } from "@/lib/auth/guard";
import { listAudit } from "@/lib/db/repositories/operations";
import { formatDate } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const scope = await requirePermission("audit.read");
  const entries = await listAudit(scope);
  return <><SectionHeading title="Audit log" description="Important operational changes are append-only records, not editable activity notes." />
    <Card>{entries.length ? <div className="table-scroll"><table><thead><tr><th>Action</th><th>Module</th><th>Target</th><th>Actor</th><th>Reason</th><th>Time</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td><b>{entry.action.replaceAll(".", " ")}</b></td><td>{entry.module}</td><td>{entry.targetType}</td><td>{entry.actorName}{entry.actorRole ? <small className="block">{entry.actorRole.replaceAll("_", " ")}</small> : null}</td><td>{entry.reason ?? "—"}</td><td>{formatDate(entry.createdAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No actions recorded" detail="Sensitive and financial operations will automatically create entries here." />}</Card>
  </>;
}
