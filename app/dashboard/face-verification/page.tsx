import { ExternalLink, ScanFace } from "lucide-react";
import { submitFaceVerificationReview } from "@/app/admin-actions";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listFaceVerificationRequests } from "@/lib/db/repositories/mobile-administration";
import { formatDate } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function FaceVerificationPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const scope = await requirePermission("face_verification.read");
  const { error, success } = await searchParams;
  const requests = await listFaceVerificationRequests(scope);
  const manage = can(scope.account.role, "face_verification.manage");
  return <>
    <SectionHeading title="Face verification" description="Review fresh encrypted selfies for Face Live access. Files remain private and every decision is audited." />
    {success ? <Notice type="success">{success}</Notice> : null}{error ? <Notice type="error">{error}</Notice> : null}
    <Card>{requests.length ? <div className="table-scroll"><table><thead><tr><th>Request</th><th>User</th><th>Country</th><th>Selfie</th><th>Submitted</th><th>Status</th>{manage ? <th>Decision</th> : null}</tr></thead><tbody>{requests.map((request) => <tr key={request.id}><td className="mono">{request.publicId}</td><td><b>{request.fullName}</b><small className="mono block">{request.userPublicId}</small></td><td>{request.country ?? "—"}</td><td><a className="table-link" href={`/api/documents/${request.documentId}`} target="_blank" rel="noreferrer">Secure view <ExternalLink size={13} /></a></td><td>{formatDate(request.createdAt)}</td><td><StatusBadge value={request.status} />{request.reviewReason ? <small className="block">{request.reviewReason}</small> : null}</td>{manage ? <td>{request.status === "PENDING" ? <form action={submitFaceVerificationReview} className="inline-review"><input type="hidden" name="requestId" value={request.id} /><select name="decision" defaultValue="" required><option value="" disabled>Decision…</option><option value="VERIFIED">Verify</option><option value="REJECTED">Reject</option></select><input name="reason" minLength={5} maxLength={500} required placeholder="Review reason" /><button className="table-button" type="submit">Save</button></form> : <span className="muted">Reviewed</span>}</td> : null}</tr>)}</tbody></table></div> : <EmptyState title="No face verification requests" detail="Fresh mobile selfie submissions will appear here for authorized reviewers." />}</Card>
    <p className="footnote"><ScanFace size={14} />Approval changes Face Live eligibility; it never grants host, admin, seller, or wallet permissions.</p>
  </>;
}
