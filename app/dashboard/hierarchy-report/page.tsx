import { Network } from "lucide-react";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { ReportControls, ReportPagination, type ReportFilters, reportQuery } from "@/components/report-controls";
import { requirePermission } from "@/lib/auth/guard";
import { hierarchyReport, type ReportPageInput } from "@/lib/db/repositories/owner-reports";
import { formatIst } from "@/lib/db/repositories/owner-reports";

export const dynamic = "force-dynamic";

export default async function HierarchyReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const scope = await requirePermission("hierarchy.read");
  const raw = await searchParams;
  const filters: ReportFilters = { q: typeof raw.q === "string" ? raw.q : "", status: typeof raw.status === "string" ? raw.status : "", role: typeof raw.role === "string" ? raw.role : "", page: Math.max(1, Number(raw.page) || 1) };
  const input: ReportPageInput = { ...filters };
  let data: Awaited<ReturnType<typeof hierarchyReport>> | null = null;
  let error = "";
  try { data = await hierarchyReport(scope, input); } catch (cause) { error = cause instanceof Error ? cause.message : "Report unavailable."; }
  const q = reportQuery(filters);
  const exportHref = `/api/reports/hierarchy?format=xlsx${q ? `&${q}` : ""}`;
  return <>
    <SectionHeading title="Hierarchy Report" description="Authorized platform nodes and their real descendant Agency/Host counts." action={<span className="scope-lock"><Network size={15} />{scope.isGlobal ? "Entire platform" : "Your branch only"}</span>} />
    {error ? <Notice type="error">{error}</Notice> : null}
    <Notice>Target fields are included in Excel but are marked “Not configured” because the current canonical schema has no Host target assignment source.</Notice>
    <Card><ReportControls action="/dashboard/hierarchy-report" filters={filters} exportHref={exportHref} statuses={["ACTIVE", "SUSPENDED", "DISABLED"]} roles={["MASTER", "COUNTRY_MANAGER", "SUPER_ADMIN", "ADMIN", "BD", "AGENCY", "COIN_SELLER"]} />
      {data?.items.length ? <div className="table-scroll"><table><thead><tr><th>ID / Name</th><th>Role</th><th>Parent ID</th><th>Admin ID</th><th>Agency ID</th><th>Agencies</th><th>Hosts</th><th>Active</th><th>Inactive</th><th>Pending</th><th>Joined (IST)</th><th>Status</th></tr></thead><tbody>{data.items.map((row) => <tr key={row.id}><td data-label="ID / Name"><b>{row.name}</b><small className="block mono">{row.id}</small></td><td data-label="Role">{row.role.replaceAll("_", " ")}</td><td data-label="Parent ID" className="mono">{row.parentId ?? "—"}</td><td data-label="Admin ID" className="mono">{row.adminId ?? "—"}</td><td data-label="Agency ID" className="mono">{row.agencyId ?? "—"}</td><td data-label="Agencies">{row.totalAgencies}</td><td data-label="Hosts">{row.totalHosts}</td><td data-label="Active">{row.activeHosts}</td><td data-label="Inactive">{row.inactiveHosts}</td><td data-label="Pending">{row.pendingHosts}</td><td data-label="Joined (IST)">{formatIst(row.joinedAt)}</td><td data-label="Status"><StatusBadge value={row.status} /></td></tr>)}</tbody></table></div> : <EmptyState title="No hierarchy records" detail="No nodes match this authorized scope and filter." />}
      {data ? <ReportPagination action="/dashboard/hierarchy-report" filters={filters} page={data.page} hasNext={data.hasNext} /> : null}
    </Card>
  </>;
}
