import Link from "next/link";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { requirePermission } from "@/lib/auth/guard";
import { listHosts } from "@/lib/db/repositories/directory";
import { formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function HostsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const scope = await requirePermission("hosts.read");
  const [{ error, success }, hosts] = await Promise.all([searchParams, listHosts(scope)]);
  return <>
    <SectionHeading title="Hosts" description="Every Nazraa application user is host-enabled automatically. This page shows status, Agency linkage, server-timed activity, and earnings—there is no apply-to-host queue." />
    {success ? <Notice type="success">{success}</Notice> : null}
    {error ? <Notice type="error">{error}</Notice> : null}
    <Card>{hosts.length ? <div className="table-scroll"><table><thead><tr><th>Host</th><th>Agency</th><th>Status</th><th className="align-right">Live hours (30d)</th><th className="align-right">Sessions</th><th className="align-right">Gifts value</th><th>Open</th></tr></thead><tbody>{hosts.map((host) => <tr key={host.id}>
      <td><b>{host.fullName}</b><small className="mono block">{host.externalUserId}</small></td>
      <td>{host.agencyName ?? "Independent"}</td>
      <td><StatusBadge value={host.status} /></td>
      <td className="align-right">{(host.liveMinutes / 60).toFixed(1)}</td>
      <td className="align-right">{formatNumber(host.sessions)}</td>
      <td className="align-right">{formatNumber(host.gifts)}</td>
      <td><Link className="table-link" href={`/dashboard/hosts/${host.id}`}>Details</Link></td>
    </tr>)}</tbody></table></div> : <EmptyState title="No users yet" detail="Google-authenticated application users will be host-enabled automatically." />}</Card>
  </>;
}
