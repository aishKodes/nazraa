import Link from "next/link";
import { Download } from "lucide-react";

export type ReportFilters = { q?: string; page?: number; period?: "24h" | "30d" | "custom"; from?: string; to?: string; status?: string; role?: string; mode?: "24h" | "date"; date?: string };

export function reportQuery(filters: ReportFilters, overrides: Partial<ReportFilters> = {}) {
  const values = { ...filters, ...overrides };
  const query = new URLSearchParams();
  for (const key of ["q", "period", "from", "to", "status", "role", "mode", "date"] as const) if (values[key]) query.set(key, String(values[key]));
  if (values.page && values.page > 1) query.set("page", String(values.page));
  return query.toString();
}

export function ReportControls({ action, filters, exportHref, periods = false, statuses = [], roles = [] }: {
  action: string; filters: ReportFilters; exportHref?: string; periods?: boolean; statuses?: string[]; roles?: string[];
}) {
  return <div className="filter-bar" style={{ alignItems: "stretch", flexWrap: "wrap" }}>
    <form action={action} method="GET" className="report-filters">
      <input name="q" defaultValue={filters.q} placeholder="Search User ID, Host ID or name" aria-label="Search report" />
      {periods ? <><select name="period" defaultValue={filters.period ?? "30d"} aria-label="Date range"><option value="24h">Last 24 Hours</option><option value="30d">Last 30 Days</option><option value="custom">Custom Date Range</option></select><label className="report-date">From <input type="date" name="from" defaultValue={filters.from} /></label><label className="report-date">To <input type="date" name="to" defaultValue={filters.to} /></label></> : null}
      {filters.mode !== undefined ? <><select name="mode" defaultValue={filters.mode} aria-label="Transfer date filter"><option value="24h">Last 24 Hours</option><option value="date">Date Wise</option></select><label className="report-date">IST date <input type="date" name="date" required={filters.mode === "date"} defaultValue={filters.date} /></label></> : null}
      {statuses.length ? <select name="status" defaultValue={filters.status ?? ""} aria-label="Status"><option value="">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select> : null}
      {roles.length ? <select name="role" defaultValue={filters.role ?? ""} aria-label="Role"><option value="">All roles</option>{roles.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select> : null}
      <button className="primary-button" type="submit">Apply filters</button>
    </form>
    {exportHref ? <Link className="secondary-button" href={exportHref}><Download size={15} />Download Excel</Link> : null}
  </div>;
}

export function ReportPagination({ action, filters, page, hasNext }: { action: string; filters: ReportFilters; page: number; hasNext: boolean }) {
  const previous = page > 1 ? `${action}?${reportQuery(filters, { page: page - 1 })}` : null;
  const next = hasNext ? `${action}?${reportQuery(filters, { page: page + 1 })}` : null;
  return <div className="pagination"><span>{page > 1 ? `Page ${page}` : "First page"}</span>{previous ? <Link className="secondary-button" href={previous}>Previous</Link> : <span />}{next ? <Link className="secondary-button" href={next}>Next</Link> : <span>End of results</span>}</div>;
}
