import { countryName } from "@/lib/countries";
import Link from "next/link";
import { Building2, LockKeyhole, Search } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listAgenciesPage } from "@/lib/db/repositories/directory";
import { listAgencyApplications } from "@/lib/db/repositories/agency-applications";
import { submitAgencyApplicationReview } from "@/app/admin-actions";
import { formatDate } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function AgenciesPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string; q?: string; page?: string }> }) {
  const scope = await requirePermission("agencies.read");
  const { error, success, q, page: rawPage } = await searchParams;
  const canReview = can(scope.account.role, "agencies.review");
  const [result, applications] = await Promise.all([
    listAgenciesPage(scope, { search: q, page: Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1) }),
    canReview ? listAgencyApplications(scope) : Promise.resolve([]),
  ]);
  const agencies = result.items;
  return <>
    <SectionHeading title={scope.account.role === "AGENCY" ? "My Agency" : "Agencies"} description={scope.account.role === "AGENCY" ? "Your Agency, host count, and current status." : "Create and review agencies only inside your permitted branch."} action={can(scope.account.role, "agencies.create") ? <Link className="primary-button" href="/dashboard/accounts#create-account"><Building2 size={16} />Create Agency</Link> : <span className="scope-lock"><LockKeyhole size={14} />Scoped view</span>} />
    {success ? <Notice type="success">{success}</Notice> : null}{error ? <Notice type="error">{error}</Notice> : null}
    {canReview ? applications.length ? <Card><h2>Agency requests</h2><div className="table-scroll"><table><thead><tr><th>Applicant</th><th>Request</th><th>Agency / parent</th><th>Protected KYC</th><th>Submitted</th><th>Status</th><th>Review</th></tr></thead><tbody>{applications.map((application) => <tr key={application.id}><td data-label="Applicant"><b>{application.ownerName ?? application.userName}</b><small className="block">App user: {application.userName}</small><small className="block mono">ID {application.userPublicId}</small></td><td data-label="Request">{application.type === "JOIN" ? "Join" : "Create"}{application.countryCode ? <small className="block">{countryName(application.countryCode)} · {application.whatsapp}</small> : null}</td><td data-label="Agency"><b>{application.agencyName}</b>{application.agencyPublicId ? <small className="block mono">Agency ID {application.agencyPublicId}</small> : null}{application.parentPublicId ? <small className="block">Under {application.parentRole} {application.parentName} · <span className="mono">{application.parentPublicId}</span></small> : null}</td><td data-label="KYC">{application.type === "CREATE" ? <><small className="block">PAN {application.panMasked ?? "legacy"}</small><small className="block">Aadhaar {application.aadhaarMasked ?? "legacy"}</small><div className="account-actions">{application.panMasked ? <a className="table-link" href={`/api/agency-applications/${application.id}/pan`}>View PAN</a> : null}{application.aadhaarMasked ? <a className="table-link" href={`/api/agency-applications/${application.id}/aadhaar`}>View Aadhaar</a> : null}{application.hasDocument ? <a className="table-link" href={`/api/agency-applications/${application.id}/document`}>Proof</a> : null}</div></> : "—"}</td><td data-label="Submitted">{formatDate(application.createdAt)}</td><td data-label="Status"><StatusBadge value={application.status} /></td><td data-label="Review">{application.status === "PENDING" ? <form action={submitAgencyApplicationReview} className="inline-action-form"><input type="hidden" name="applicationId" value={application.id} /><input type="hidden" name="type" value={application.type} /><select name="decision" defaultValue="APPROVED"><option value="APPROVED">Approve</option><option value="REJECTED">Reject</option></select><input name="reason" required minLength={5} maxLength={500} placeholder="Review reason" /><button type="submit" className="table-link button-link">Save</button></form> : "—"}</td></tr>)}</tbody></table></div></Card> : <Card><EmptyState title="No Agency requests" detail="New requests in your branch will appear here." /></Card> : null}
    <Card><form className="filter-bar" action="/dashboard/agencies"><label className="search-field"><Search size={17} /><input name="q" defaultValue={q} placeholder="Search Agency ID, name, or phone" /><button className="primary-button" type="submit">Search</button></label><span>Page {result.page}</span></form>{agencies.length ? <div className="table-scroll"><table><thead><tr><th>Agency</th><th>Code</th><th>Country</th><th>Managed by</th><th className="align-right">Hosts</th><th>Status</th></tr></thead><tbody>{agencies.map((agency) => <tr key={agency.id}><td data-label="Agency">{can(scope.account.role, "accounts.read") ? <Link className="table-link" href={`/dashboard/accounts/${agency.id}`}><b>{agency.name}</b></Link> : <b>{agency.name}</b>}</td><td data-label="Code" className="mono">{agency.code}</td><td data-label="Country">{countryName(agency.country)}</td><td data-label="Managed by">{agency.owner ?? "Platform"}</td><td data-label="Hosts" className="align-right">{agency.hostCount}</td><td data-label="Status"><StatusBadge value={agency.status} /></td></tr>)}</tbody></table></div> : <EmptyState title="No agencies in this branch" detail="New agencies will inherit their Admin, Super Admin, and Country Manager scope." />}<Pagination path="/dashboard/agencies" page={result.page} hasNext={result.hasNext} query={{ q }} /></Card>
  </>;
}
