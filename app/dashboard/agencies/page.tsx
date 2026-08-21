import Link from "next/link";
import { Building2, LockKeyhole } from "lucide-react";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { requirePermission } from "@/lib/auth/guard";
import { listAgencies } from "@/lib/db/repositories/directory";
import { listAgencyApplications } from "@/lib/db/repositories/agency-applications";
import { listParentOptions } from "@/lib/db/repositories/administration";
import { submitAgencyApplicationReview } from "@/app/admin-actions";
import { formatDate } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function AgenciesPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const scope = await requirePermission("agencies.read");
  const [{ error, success }, agencies, applications, parentOptions] = await Promise.all([
    searchParams,
    listAgencies(scope),
    listAgencyApplications(scope),
    scope.account.role === "MASTER" || scope.account.role === "SUPER_ADMIN" ? listParentOptions(scope) : Promise.resolve([]),
  ]);
  return <>
    <SectionHeading title="Agencies" description="Review mobile join and creation applications. Membership is only changed after an authorized approval." action={scope.account.role === "ADMIN" || scope.account.role === "SUPER_ADMIN" || scope.account.role === "MASTER" ? <Link className="primary-button" href="/dashboard/accounts#create-account"><Building2 size={16} />Create manually</Link> : <span className="scope-lock"><LockKeyhole size={14} />Scoped view</span>} />
    {success ? <Notice type="success">{success}</Notice> : null}{error ? <Notice type="error">{error}</Notice> : null}
    {applications.length ? <Card><h2>Mobile applications</h2><div className="table-scroll"><table><thead><tr><th>Applicant</th><th>Request</th><th>Agency</th><th>Submitted</th><th>Status</th><th>Review</th></tr></thead><tbody>{applications.map((application) => <tr key={application.id}><td><b>{application.userName}</b><small className="block mono">ID {application.userPublicId}</small></td><td>{application.type === "JOIN" ? "Join" : "Create"}{application.countryCode ? <small className="block">{application.countryCode} · {application.whatsapp}</small> : null}</td><td><b>{application.agencyName}</b>{application.agencyPublicId ? <small className="block mono">ID {application.agencyPublicId}</small> : null}</td><td>{formatDate(application.createdAt)}</td><td><StatusBadge value={application.status} /></td><td>{application.status === "PENDING" ? <form action={submitAgencyApplicationReview} className="inline-action-form"><input type="hidden" name="applicationId" value={application.id} /><input type="hidden" name="type" value={application.type} />{application.type === "CREATE" && scope.account.role === "MASTER" ? <select name="parentAccountId" required defaultValue=""><option value="" disabled>Managing Admin</option>{parentOptions.filter((parent) => parent.role === "ADMIN").map((parent) => <option key={parent.id} value={parent.id}>{parent.name}</option>)}</select> : null}<select name="decision" defaultValue="APPROVED"><option value="APPROVED">Approve</option><option value="REJECTED">Reject</option></select><input name="reason" required minLength={5} maxLength={500} placeholder="Review reason" /><button type="submit" className="table-link button-link">Save</button></form> : "—"}</td></tr>)}</tbody></table></div></Card> : <Card><EmptyState title="No Agency applications" detail="New mobile join and creation requests will appear here." /></Card>}
    <Card>{agencies.length ? <div className="table-scroll"><table><thead><tr><th>Agency</th><th>Code</th><th>Country</th><th>Managed by</th><th className="align-right">Hosts</th><th>Status</th></tr></thead><tbody>{agencies.map((agency) => <tr key={agency.id}><td><Link className="table-link" href={`/dashboard/accounts/${agency.id}`}><b>{agency.name}</b></Link></td><td className="mono">{agency.code}</td><td>{agency.country ?? "—"}</td><td>{agency.owner ?? "Master"}</td><td className="align-right">{agency.hostCount}</td><td><StatusBadge value={agency.status} /></td></tr>)}</tbody></table></div> : <EmptyState title="No agencies in this branch" detail="New agencies will automatically inherit their Admin and Super Admin scope." />}</Card>
  </>;
}
