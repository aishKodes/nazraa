import { submitRiskStatus } from "@/app/admin-actions";
import { Pagination } from "@/components/pagination";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listRiskFlags } from "@/lib/db/repositories/operations";
import { formatDate } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function RiskPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string; page?: string }> }) {
  const scope = await requirePermission("risk.read");
  const { error, success, page: rawPage } = await searchParams; const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1); const rows = await listRiskFlags(scope, page); const flags = rows.slice(0, 25); const manage = can(scope.account.role, "risk.manage");
  return <><SectionHeading title="Risk queue" description="Flags inform review. No automated rule can permanently ban a user on its own." />{success ? <Notice type="success">{success}</Notice> : null}{error ? <Notice type="error">{error}</Notice> : null}
    <Card>{flags.length ? <div className="table-scroll"><table><thead><tr><th>Severity</th><th>Flag</th><th>User</th><th>Summary</th><th>Status</th><th>Created</th>{manage ? <th>Review</th> : null}</tr></thead><tbody>{flags.map((flag) => <tr key={flag.id}><td><StatusBadge value={flag.severity} /></td><td className="mono">{flag.ruleKey}</td><td>{flag.name ? <><b>{flag.name}</b><small className="block mono">{flag.externalUserId}</small></> : "Platform"}</td><td>{flag.summary}</td><td><StatusBadge value={flag.status} /></td><td>{formatDate(flag.createdAt)}</td>{manage ? <td><details className="row-action"><summary>Update</summary><form action={submitRiskStatus}><input type="hidden" name="flagId" value={flag.id} /><select name="status" required defaultValue=""><option value="" disabled>Status</option><option value="REVIEWING">Reviewing</option><option value="RESOLVED">Resolved</option></select><input name="reason" required minLength={5} placeholder="Review reason" /><button className="secondary-button" type="submit">Save</button></form></details></td> : null}</tr>)}</tbody></table></div> : <EmptyState title="No open risk flags" detail="Risk rules or manual reviewers can create flags here for human investigation." />}<Pagination path="/dashboard/risk" page={page} hasNext={rows.length > 25} /></Card>
  </>;
}
