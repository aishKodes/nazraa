import { Card, EmptyState, SectionHeading } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { requirePermission } from "@/lib/auth/guard";
import { listAuditPage } from "@/lib/db/repositories/operations";
import { formatDate } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const scope = await requirePermission("audit.read");
  const { page: rawPage } = await searchParams;
  const result = await listAuditPage(scope, { page: Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1) });
  const entries = result.items;
  return <><SectionHeading title="Audit log" description="Important operational changes are append-only records, not editable activity notes." />
    <Card>{entries.length ? <div className="table-scroll"><table><thead><tr><th>Action</th><th>Module</th><th>Target</th><th>Actor</th><th>Reason</th><th>Time</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td data-label="Action"><b>{entry.action.replaceAll(".", " ")}</b></td><td data-label="Module">{entry.module}</td><td data-label="Target">{entry.targetType}</td><td data-label="Actor">{entry.actorName}{entry.actorRole ? <small className="block">{entry.actorRole.replaceAll("_", " ")}</small> : null}</td><td data-label="Reason">{entry.reason ?? "—"}</td><td data-label="Time">{formatDate(entry.createdAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No actions recorded" detail="Sensitive and financial operations will automatically create entries here." />}<Pagination path="/dashboard/audit" page={result.page} hasNext={result.hasNext} /></Card>
  </>;
}
