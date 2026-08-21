import { ExternalLink, ScanFace } from "lucide-react";
import { submitFaceLiveAuthorization, submitFaceVerificationReview } from "@/app/admin-actions";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listFaceVerificationRequests } from "@/lib/db/repositories/mobile-administration";
import { formatDate } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function FaceVerificationPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const scope = await requirePermission("face_verification.read");
  const [{ error, success }, requests] = await Promise.all([searchParams, listFaceVerificationRequests(scope)]);
  const manageLegacy = can(scope.account.role, "face_verification.manage");
  const authorize = can(scope.account.role, "face_live.authorize");
  const authorizationTypes = scope.account.role === "AGENCY"
    ? ["AGENCY_FACE_LIVE"] as const
    : scope.account.role === "SUPER_ADMIN"
      ? ["SUPER_ADMIN_FACE_LIVE"] as const
      : ["AGENCY_FACE_LIVE", "SUPER_ADMIN_FACE_LIVE"] as const;

  return <>
    <SectionHeading title="Face verification & Live access" description="The private-beta flow automatically approves one encrypted selfie capture. Agency and Super Admin Live authorizations remain separate, explicit, and audited." />
    {success ? <Notice type="success">{success}</Notice> : null}
    {error ? <Notice type="error">{error}</Notice> : null}
    <Card>{requests.length ? <div className="table-scroll"><table><thead><tr>
      <th>Request</th><th>User</th><th>Capture mode</th><th>Evidence</th><th>Submitted</th><th>Status</th><th>Live authorization</th>{manageLegacy ? <th>Legacy exception</th> : null}
    </tr></thead><tbody>{requests.map((request) => <tr key={request.id}>
      <td className="mono">{request.publicId}</td>
      <td><b>{request.fullName}</b><small className="mono block">{request.userPublicId} · {request.country ?? "—"}</small></td>
      <td>{request.provider ?? "Legacy"}<small className="block">Single capture · no biometric matching</small></td>
      <td>{request.documentId ? <a className="table-link" href={`/api/documents/${request.documentId}`} target="_blank" rel="noreferrer">Restricted view <ExternalLink size={13} /></a> : <span className="muted">No encrypted capture available</span>}</td>
      <td>{formatDate(request.createdAt)}</td>
      <td><StatusBadge value={request.status} />{request.reviewReason ? <small className="block">{request.reviewReason}</small> : null}</td>
      <td>
        <small className="block">Agency: {request.agencyAuthorized ? "APPROVED" : "LOCKED"}</small>
        <small className="block">Super Admin: {request.superAdminAuthorized ? "APPROVED" : "LOCKED"}</small>
        {authorize && request.status === "VERIFIED" ? <form action={submitFaceLiveAuthorization} className="inline-review">
          <input type="hidden" name="userPublicId" value={request.userPublicId} />
          <select name="authorizationType" required defaultValue=""><option value="" disabled>Authorization…</option>{authorizationTypes.map((type) => <option key={type}>{type}</option>)}</select>
          <select name="approved" defaultValue="true"><option value="true">Approve</option><option value="false">Revoke</option></select>
          <input name="reason" required minLength={5} maxLength={500} placeholder="Authorization reason" />
          <button className="table-button" type="submit">Save</button>
        </form> : null}
      </td>
      {manageLegacy ? <td>{request.status === "PENDING" ? <form action={submitFaceVerificationReview} className="inline-review"><input type="hidden" name="requestId" value={request.id} /><select name="decision" defaultValue="" required><option value="" disabled>Decision…</option><option value="VERIFIED">Verify</option><option value="REJECTED">Reject</option></select><input name="reason" minLength={5} maxLength={500} required placeholder="Recovery reason" /><button className="table-button" type="submit">Save</button></form> : <span className="muted">Automatic flow</span>}</td> : null}
    </tr>)}</tbody></table></div> : <EmptyState title="No Face Verification activity" detail="Automatic mobile verification results will appear here without creating fake queue data." />}</Card>
    <p className="footnote"><ScanFace size={14} />Government ID is not part of normal Face Verification. Video/Face Live needs verified + approved Agency + Agency authorization + Super Admin authorization.</p>
  </>;
}
