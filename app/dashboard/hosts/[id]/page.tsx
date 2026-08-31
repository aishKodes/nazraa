import { countryName } from "@/lib/countries";
import Link from "next/link";
import { ArrowLeft, Download, FileLock2, Upload } from "lucide-react";
import { notFound } from "next/navigation";
import { submitDocumentReview, submitHostDocument, submitHostReview, submitHostStatus } from "@/app/admin-actions";
import { Card, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listAgencies } from "@/lib/db/repositories/directory";
import { getHostDetail, listHostDocuments } from "@/lib/db/repositories/hosts";
import { formatDate } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function HostDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; success?: string }> }) {
  const scope = await requirePermission("hosts.read");
  const { id } = await params; const { error, success } = await searchParams;
  const mayReadDocuments = can(scope.account.role, "documents.read");
  const [host, documents, agencies] = await Promise.all([getHostDetail(scope, id), mayReadDocuments ? listHostDocuments(scope, id) : Promise.resolve([]), listAgencies(scope)]);
  if (!host) notFound();
  const mayReview = can(scope.account.role, "hosts.review"); const mayUpload = can(scope.account.role, "documents.upload"); const mayReviewDocuments = can(scope.account.role, "documents.manage");
  return <><Link href="/dashboard/hosts" className="back-link"><ArrowLeft size={15} />Host applications</Link><SectionHeading title={host.legalName} description={`${host.externalUserId} · ${countryName(host.country)}`} action={<StatusBadge value={host.status} />} />
    {success ? <Notice type="success">{success}</Notice> : null}{error ? <Notice type="error">{error}</Notice> : null}
    <div className="split-grid"><Card><div className="card-title"><div><h2>Application</h2><p>Identity details are masked by default.</p></div></div><dl className="detail-list"><div><dt>Display name</dt><dd>{host.displayName}</dd></div><div><dt>Government ID</dt><dd>{mayReadDocuments ? `${host.governmentIdType ?? "—"} · •••• ${host.governmentIdLast4 ?? "—"}` : "Protected for this role"}</dd></div><div><dt>Agency</dt><dd>{host.agencyName ?? "Unassigned"}</dd></div><div><dt>Applied</dt><dd>{formatDate(host.appliedAt)}</dd></div><div><dt>Reviewed</dt><dd>{formatDate(host.reviewedAt)}</dd></div><div><dt>Review note</dt><dd>{host.reviewReason ?? "—"}</dd></div></dl></Card>
      {mayReview && ["PENDING", "REJECTED"].includes(host.status) ? <Card><div className="card-title"><div><h2>Review decision</h2><p>Approval verifies the host and maps the user to an agency.</p></div></div><form action={submitHostReview} className="stack-form"><input type="hidden" name="hostId" value={host.id} /><label>Agency<select name="agencyAccountId" defaultValue={host.agencyId ?? ""}><option value="">Select agency</option>{agencies.map((agency) => <option value={agency.id} key={agency.id}>{agency.name} · {agency.code}</option>)}</select></label><label>Decision<select name="decision" required defaultValue=""><option value="" disabled>Select</option><option value="APPROVED">Approve</option><option value="REJECTED">Reject</option></select></label><label>Reason<input name="reason" minLength={5} required placeholder="Verification notes or rejection reason" /></label><button className="primary-button" type="submit">Save decision</button></form></Card> : null}
      {mayReview ? <Card><div className="card-title"><div><h2>Hosting status</h2><p>Suspending or pausing ends current rooms and blocks new Video, Party and Face Live rooms. Verification status is not changed.</p></div></div>
        <form action={submitHostStatus} className="stack-form"><input type="hidden" name="hostId" value={host.id} />
          <label>New hosting status<select name="status" required defaultValue={host.status === "SUSPENDED" || host.status === "INACTIVE" ? "ACTIVE" : "SUSPENDED"}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="SUSPENDED">Suspended</option></select></label>
          <label>Hosting status reason<input name="reason" minLength={5} maxLength={500} required placeholder="Reason for this status change" /></label>
          <label className="checkbox-line"><input type="checkbox" name="confirmed" value="yes" required />Confirm hosting status change</label>
          <button className="primary-button" type="submit">Update host</button>
        </form></Card> : null}</div>
    <Card><div className="card-title"><div><h2>Private documents</h2><p>Encrypted at rest; downloads require document permission and hierarchy scope.</p></div><FileLock2 size={20} /></div>{!mayReadDocuments ? <p className="quiet-empty">Identity documents are protected for this role.</p> : documents.length ? <div className="document-list">{documents.map((document) => <div key={document.id}><span><b>{document.type.replaceAll("_", " ")}</b><small>{document.name} · {(document.size / 1024).toFixed(0)} KB</small></span><StatusBadge value={document.status} /><a className="secondary-button" href={`/api/documents/${document.id}`}><Download size={14} />Download</a>{mayReviewDocuments ? <details className="row-action document-review"><summary>Review</summary><form action={submitDocumentReview}><input type="hidden" name="documentId" value={document.id} /><input type="hidden" name="ownerId" value={host.id} /><input type="hidden" name="ownerType" value="HOST" /><select name="status" required defaultValue=""><option value="" disabled>Decision</option><option value="VERIFIED">Verified</option><option value="REJECTED">Rejected</option></select><input name="reason" required minLength={5} placeholder="Reason" /><button className="secondary-button" type="submit">Save</button></form></details> : null}</div>)}</div> : <p className="quiet-empty">No documents uploaded.</p>}{mayUpload ? <form action={submitHostDocument} className="document-upload"><input type="hidden" name="hostId" value={host.id} /><select name="documentType" required defaultValue=""><option value="" disabled>Document type</option><option value="GOVERNMENT_ID_FRONT">ID front</option><option value="GOVERNMENT_ID_BACK">ID back</option><option value="PROFILE_PHOTO">Profile photo</option><option value="SUPPORTING_DOCUMENT">Supporting document</option></select><input type="file" name="document" required accept="image/jpeg,image/png,application/pdf" /><button className="secondary-button" type="submit"><Upload size={15} />Upload</button></form> : null}</Card>
  </>;
}
