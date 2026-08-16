import { CheckCircle2 } from "lucide-react";
import { Card, EmptyState, SectionHeading, StatusBadge } from "@/components/ui";
import { requirePermission } from "@/lib/auth/guard";
import { listHosts } from "@/lib/db/repositories/directory";
import { formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function HostsPage() {
  const scope = await requirePermission("hosts.read");
  const hosts = await listHosts(scope);
  return <>
    <SectionHeading title="Hosts" description="Review host status and the signals that matter: verification, live time, sessions, and gifts." action={scope.account.role === "MASTER" || scope.account.role === "SUPER_ADMIN" ? <span className="soft-action"><CheckCircle2 size={16} />Review queue</span> : undefined} />
    <Card>{hosts.length ? <div className="table-scroll"><table><thead><tr><th>Host</th><th>Agency</th><th>Status</th><th>Verification</th><th className="align-right">Live hours (30d)</th><th className="align-right">Sessions</th><th className="align-right">Gifts value</th></tr></thead><tbody>{hosts.map((host) => <tr key={host.id}><td><b>{host.fullName}</b><small className="mono block">{host.externalUserId}</small></td><td>{host.agencyName ?? "Unassigned"}</td><td><StatusBadge value={host.status} /></td><td><StatusBadge value={host.verificationStatus} /></td><td className="align-right">{(host.liveMinutes / 60).toFixed(1)}</td><td className="align-right">{formatNumber(host.sessions)}</td><td className="align-right">{formatNumber(host.gifts)}</td></tr>)}</tbody></table></div> : <EmptyState title="No host records yet" detail="Host applications will appear here once they are linked from the mobile backend." />}</Card>
  </>;
}
