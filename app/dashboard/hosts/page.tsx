import Link from "next/link";
import { CheckCircle2, FileLock2, Plus } from "lucide-react";
import { submitCreateHostApplication } from "@/app/admin-actions";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listAgencies, listHosts, listUsers } from "@/lib/db/repositories/directory";
import { formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function HostsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const scope = await requirePermission("hosts.read");
  const { error, success } = await searchParams;
  const [hosts, users, agencies] = await Promise.all([listHosts(scope), listUsers(scope), listAgencies(scope)]);
  const canReview = can(scope.account.role, "hosts.review");
  return <>
    <SectionHeading title="Hosts" description="Applications, private verification documents, review decisions, agency assignment, and performance in one queue." action={canReview ? <a className="primary-button" href="#new-host"><Plus size={16} />Add application</a> : undefined} />
    {success ? <Notice type="success">{success}</Notice> : null}{error ? <Notice type="error">{error}</Notice> : null}
    {canReview ? <Card className="create-panel"><details id="new-host"><summary><span><CheckCircle2 size={18} /><b>Add a host application</b></span><small>Use this for assisted onboarding; the mobile API uses the same queue.</small></summary><form action={submitCreateHostApplication} className="admin-form" encType="multipart/form-data"><div className="form-grid"><label>Application user<select name="applicationUserId" required defaultValue=""><option value="" disabled>Select existing app user</option>{users.map((user) => <option key={user.id} value={user.id}>{user.fullName} · {user.externalUserId}</option>)}</select></label><label>Legal name<input name="legalName" required /></label><label>Country code<input name="countryCode" required minLength={2} maxLength={2} placeholder="IN" /></label><label>Agency<select name="agencyAccountId" defaultValue=""><option value="">Assign during review</option>{agencies.map((agency) => <option key={agency.id} value={agency.id}>{agency.name} · {agency.code}</option>)}</select></label><label>Government ID type<input name="governmentIdType" required placeholder="Aadhaar, NID, Citizenship…" /></label><label>Government ID last 4<input name="governmentIdLast4" required minLength={4} maxLength={8} /></label><label>ID front <span>(required, max 2 MB)</span><input name="idFront" type="file" required accept="image/jpeg,image/png,application/pdf" /></label><label>ID back<input name="idBack" type="file" accept="image/jpeg,image/png,application/pdf" /></label><label>Profile photo<input name="profilePhoto" type="file" accept="image/jpeg,image/png" /></label></div><div className="form-submit"><p><FileLock2 size={15} />Files are encrypted; tables show only the last four ID digits.</p><button className="primary-button" type="submit">Submit application</button></div></form></details></Card> : null}
    <Card>{hosts.length ? <div className="table-scroll"><table><thead><tr><th>Host</th><th>Agency</th><th>Status</th><th>Verification</th><th>Documents</th><th className="align-right">Live hours (30d)</th><th className="align-right">Sessions</th><th className="align-right">Gifts value</th><th>Open</th></tr></thead><tbody>{hosts.map((host) => <tr key={host.id}><td><b>{host.fullName}</b><small className="mono block">{host.externalUserId}</small></td><td>{host.agencyName ?? "Unassigned"}</td><td><StatusBadge value={host.status} /></td><td><StatusBadge value={host.verificationStatus} /></td><td>{host.documentCount}</td><td className="align-right">{(host.liveMinutes / 60).toFixed(1)}</td><td className="align-right">{formatNumber(host.sessions)}</td><td className="align-right">{formatNumber(host.gifts)}</td><td><Link className="table-link" href={`/dashboard/hosts/${host.id}`}>Review</Link></td></tr>)}</tbody></table></div> : <EmptyState title="No host applications yet" detail="Applications submitted from the app or assisted onboarding will appear here." />}</Card>
  </>;
}
