import Link from "next/link";
import { submitSafetyReportStatus } from "@/app/admin-actions";
import { Pagination } from "@/components/pagination";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listSafetyReports, type SafetyReportStatus } from "@/lib/db/repositories/safety-moderation";
import { formatDate } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

const statuses: SafetyReportStatus[] = ["NEW", "UNDER_REVIEW", "ACTIONED", "DISMISSED"];

export default async function ModerationPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string; status?: string; page?: string }> }) {
  const scope = await requirePermission("risk.read");
  const params = await searchParams;
  const status = statuses.includes(params.status as SafetyReportStatus) ? params.status as SafetyReportStatus : "NEW";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const rows = await listSafetyReports(scope, { status, page });
  const reports = rows.slice(0, 25);
  const manage = can(scope.account.role, "risk.manage");
  return <>
    <SectionHeading title="Moderation center" description="One human-reviewed queue for user, Host, room, content, message, copyright, and child-safety reports." />
    {params.success ? <Notice type="success">{params.success}</Notice> : null}
    {params.error ? <Notice type="error">{params.error}</Notice> : null}
    <div className="filter-row" aria-label="Moderation status">
      {statuses.map((item) => <Link className={item === status ? "filter-chip active" : "filter-chip"} href={`/dashboard/moderation?status=${item}`} key={item}>{item.replaceAll("_", " ")}</Link>)}
    </div>
    <Card>{reports.length ? <div className="table-scroll"><table><thead><tr><th>Severity</th><th>Report</th><th>Reporter</th><th>Target / reference</th><th>Reason</th><th>Created</th>{manage ? <th>Review</th> : null}</tr></thead><tbody>
      {reports.map((report) => <tr key={report.id}>
        <td><StatusBadge value={report.severity} /></td>
        <td><b>{report.reportType.replaceAll("_", " ")}</b><small className="block mono">{report.id}</small></td>
        <td><b>{report.reporterName}</b><small className="block mono">ID {report.reporterPublicId}</small></td>
        <td>{report.targetName ? <><b>{report.targetName}</b><small className="block mono">ID {report.targetPublicId}</small></> : "Platform / content"}<small className="block mono">{report.roomCode ? `Room ${report.roomCode}` : report.contentId ? `Content ${report.contentId}` : report.messageId ? `Message ${report.messageId}` : "No extra reference"}</small></td>
        <td><b>{report.reasonCode.replaceAll("_", " ")}</b><small className="block">{report.reasonDetail ?? "No additional detail"}</small></td>
        <td>{formatDate(report.createdAt)}</td>
        {manage ? <td><details className="row-action"><summary>Update</summary><form action={submitSafetyReportStatus}>
          <input type="hidden" name="reportId" value={report.id} /><input type="hidden" name="returnStatus" value={status} />
          <select name="status" required defaultValue={report.status}><option value="NEW">New</option><option value="UNDER_REVIEW">Under review</option><option value="ACTIONED">Actioned</option><option value="DISMISSED">Dismissed</option></select>
          <input name="note" required minLength={5} maxLength={500} placeholder="Review/action note" />
          <button className="secondary-button" type="submit">Save audited update</button>
        </form></details></td> : null}
      </tr>)}
    </tbody></table></div> : <EmptyState title={`No ${status.toLowerCase().replaceAll("_", " ")} reports`} detail="New mobile and website safety reports will appear here without exposing private evidence publicly." />}
      <Pagination path="/dashboard/moderation" page={page} hasNext={rows.length > 25} query={{ status }} />
    </Card>
  </>;
}
