import { Building2, FileSpreadsheet, Network } from "lucide-react";
import { Badge, Card, EmptyState, MetricCard, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { ReportControls, ReportPagination, type ReportFilters, reportQuery } from "@/components/report-controls";
import { requirePermission } from "@/lib/auth/guard";
import { agencyHostReport, formatIst, type ReportPageInput } from "@/lib/db/repositories/owner-reports";

export const dynamic = "force-dynamic";

export default async function AgencyReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const scope = await requirePermission("reports.export");
  const raw = await searchParams;
  const filters: ReportFilters = { q: typeof raw.q === "string" ? raw.q : "", status: typeof raw.status === "string" ? raw.status : "", page: Math.max(1, Number(raw.page) || 1) };
  const input: ReportPageInput = { ...filters };
  let data: Awaited<ReturnType<typeof agencyHostReport>> | null = null;
  let error = "";
  try { data = await agencyHostReport(scope, input); } catch (cause) { error = cause instanceof Error ? cause.message : "Report unavailable."; }
  const exportHref = `/api/reports/agency-hosts?format=xlsx${reportQuery(filters) ? `&${reportQuery(filters)}` : ""}`;
  return <>
    <SectionHeading title="Agency Report" description="Agency, Host status and joining dates in your authorized hierarchy. Assigned-target data is shown only if a canonical target source exists." action={<span className="scope-lock"><Network size={15} />{scope.isGlobal ? "Entire platform" : "Your authorized branch"}</span>} />
    {error ? <Notice type="error">{error}</Notice> : null}
    <div className="metric-grid"><MetricCard label="Agencies represented" value={data?.agencyCount ?? 0} icon={<Building2 size={20} />} /><MetricCard label="Hosts in filtered result" value={data?.total ?? 0} icon={<FileSpreadsheet size={20} />} /></div>
    {!data?.targetSourceAvailable ? <Notice>Host target assignment/achievement is not configured in the current canonical data model. Target columns are marked “Not configured”; no target rule has been inferred.</Notice> : null}
    <Card>
      <ReportControls action="/dashboard/agency-report" filters={filters} exportHref={exportHref} statuses={["PENDING", "APPROVED", "ACTIVE", "INACTIVE", "SUSPENDED", "REJECTED"]} />
      {data?.items.length ? <div className="table-scroll"><table><thead><tr><th>Agency</th><th>Admin ID</th><th>Host ID</th><th>Host</th><th>Joining date (IST)</th><th>Host status</th><th>Account</th><th>Target</th></tr></thead><tbody>{data.items.map((row) => <tr key={`${row.hostExternalId}:${row.agencyId}`}><td data-label="Agency"><b>{row.agencyName ?? "Unassigned"}</b><small className="block">ID {row.agencyId ?? "—"}{row.agencyCountry ? ` · ${row.agencyCountry}` : ""}</small></td><td data-label="Admin ID" className="mono">{row.adminId ?? "—"}</td><td data-label="Host ID" className="mono">{row.hostId}</td><td data-label="Host">{row.hostName}<small className="block mono">{row.hostExternalId}</small></td><td data-label="Joining date (IST)">{formatIst(row.joiningDate)}</td><td data-label="Host status"><StatusBadge value={row.hostStatus} /></td><td data-label="Account"><StatusBadge value={row.accountStatus} /></td><td data-label="Target"><Badge>Not configured</Badge></td></tr>)}</tbody></table></div> : <EmptyState title="No Host records" detail="No Host profiles match this authorized scope and filter." />}
      {data ? <ReportPagination action="/dashboard/agency-report" filters={filters} page={data.page} hasNext={data.hasNext} /> : null}
    </Card>
  </>;
}
