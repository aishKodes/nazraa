import { countryName } from "@/lib/countries";
import Image from "next/image";
import { FileText, ScanFace } from "lucide-react";
import { submitFaceVerificationReview } from "@/app/admin-actions";
import { Pagination } from "@/components/pagination";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listFaceVerificationRequests } from "@/lib/db/repositories/mobile-administration";
import { formatDate } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function FaceVerificationPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string; page?: string }> }) {
  const scope = await requirePermission("face_verification.read");
  const { error, success, page: rawPage } = await searchParams;
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const rows = await listFaceVerificationRequests(scope, page);
  const requests = rows.slice(0, 25);
  const mayReview = can(scope.account.role, "face_verification.manage");

  return <>
    <SectionHeading title="Face verification" description="One approval applies everywhere. A verified Host does not need separate Agency, Admin, or Super Admin verification." />
    {success ? <Notice type="success">{success}</Notice> : null}
    {error ? <Notice type="error">{error}</Notice> : null}
    <Card>{requests.length ? <div className="table-scroll"><table><thead><tr>
      <th>User</th><th>Selfie</th><th>Submitted</th><th>Status</th>{mayReview ? <th>Decision</th> : null}
    </tr></thead><tbody>{requests.map((request) => <tr key={request.id}>
      <td data-label="User"><b>{request.fullName}</b><small className="mono block">{request.userPublicId} · {countryName(request.country)}</small></td>
      <td data-label="Selfie">{request.documentId && request.documentMimeType?.startsWith("image/") ? <a className="verification-thumb-link" href={`/api/documents/${request.documentId}?inline=1`} target="_blank" rel="noreferrer"><Image className="verification-thumb" src={`/api/documents/${request.documentId}?preview=1`} alt={`${request.fullName} verification selfie`} width={64} height={64} unoptimized /><span><b>Selfie uploaded</b><small>Tap to inspect</small></span></a> : request.documentId ? <a className="verification-file-link" href={`/api/documents/${request.documentId}`} target="_blank" rel="noreferrer"><FileText size={22} /><span><b>File uploaded</b><small>Tap to inspect</small></span></a> : <span className="verification-missing">Selfie missing</span>}</td>
      <td data-label="Submitted">{formatDate(request.createdAt)}</td>
      <td data-label="Status"><StatusBadge value={request.status} />{request.requestStatus !== request.status ? <small className="block">Latest capture: {request.requestStatus}</small> : null}{request.reviewReason ? <small className="block">{request.reviewReason}</small> : null}</td>
      {mayReview ? <td data-label="Decision">{request.status === "VERIFIED" ? <><span className="verification-approved">Verified once · active everywhere</span><details className="row-action"><summary>Correct a wrong approval</summary><form action={submitFaceVerificationReview} className="inline-review"><input type="hidden" name="requestId" value={request.id} /><input type="hidden" name="decision" value="REJECTED" /><input name="reason" minLength={5} maxLength={500} required placeholder="Why this approval is being revoked" /><button className="danger-button" type="submit">Reject verification</button></form></details></> : <form action={submitFaceVerificationReview} className="inline-review"><input type="hidden" name="requestId" value={request.id} /><select name="decision" defaultValue="" required><option value="" disabled>Choose decision</option><option value="VERIFIED">Approve</option><option value="REJECTED">Reject</option></select><input name="reason" minLength={5} maxLength={500} required placeholder="Reason" /><button className="table-button" type="submit">Save</button></form>}</td> : null}
    </tr>)}</tbody></table></div> : <EmptyState title="No Face Verification activity" detail="Automatic mobile verification results will appear here without creating fake queue data." />}<Pagination path="/dashboard/face-verification" page={page} hasNext={rows.length > 25} /></Card>
    <p className="footnote"><ScanFace size={14} />A verified Host can use Party Audio. Face Live additionally requires membership in an approved Agency; it never requires another verification decision.</p>
  </>;
}
