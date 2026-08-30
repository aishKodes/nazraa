import Link from "next/link";
import { Search } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { requirePermission } from "@/lib/auth/guard";
import { listHostsPage } from "@/lib/db/repositories/directory";
import { formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function HostsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string; q?: string; page?: string }> }) {
  const scope = await requirePermission("hosts.read");
  const { error, success, q, page: rawPage } = await searchParams;
  const result = await listHostsPage(scope, { search: q, page: Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1) });
  const hosts = result.items;
  return <>
    <SectionHeading title="Hosts" description="Every Nazraa application user is host-enabled automatically. This page shows status, Agency linkage, server-timed activity, and earnings—there is no apply-to-host queue." />
    {success ? <Notice type="success">{success}</Notice> : null}
    {error ? <Notice type="error">{error}</Notice> : null}
    <Card><form className="filter-bar" action="/dashboard/hosts"><label className="search-field"><Search size={17} /><input name="q" defaultValue={q} placeholder="Search host ID, name, or phone" /><button className="primary-button" type="submit">Search</button></label><span>Page {result.page}</span></form>{hosts.length ? <div className="table-scroll"><table><thead><tr><th>Host</th><th>Agency</th><th>Status</th><th className="align-right">Live hours (30d)</th><th className="align-right">Sessions</th><th className="align-right">Gifts value</th><th>Open</th></tr></thead><tbody>{hosts.map((host) => <tr key={host.id}>
      <td data-label="Host"><b>{host.fullName}</b><small className="mono block">{host.externalUserId}</small></td>
      <td data-label="Agency">{host.agencyName ?? "Independent"}</td>
      <td data-label="Status"><StatusBadge value={host.status} /></td>
      <td data-label="Live hours" className="align-right">{(host.liveMinutes / 60).toFixed(1)}</td>
      <td data-label="Sessions" className="align-right">{formatNumber(host.sessions)}</td>
      <td data-label="Gifts" className="align-right">{formatNumber(host.gifts)}</td>
      <td data-label="Open"><Link className="table-link" href={`/dashboard/hosts/${host.id}`}>Details</Link></td>
    </tr>)}</tbody></table></div> : <EmptyState title="No users yet" detail="Google-authenticated application users will be host-enabled automatically." />}<Pagination path="/dashboard/hosts" page={result.page} hasNext={result.hasNext} query={{ q }} /></Card>
  </>;
}
