import { Check, Landmark } from "lucide-react";
import { submitWithdrawalTransition } from "@/app/actions";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listWithdrawals } from "@/lib/db/repositories/operations";
import { formatDate, formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function WithdrawalsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const scope = await requirePermission("withdrawals.read");
  const { error, success } = await searchParams;
  const withdrawals = await listWithdrawals(scope);
  const canReview = can(scope.account.role, "withdrawals.review");
  return <><SectionHeading title="Withdrawals" description="Review status separately from payment completion. Payout details are always masked." />
    {success ? <Notice type="success">{success}</Notice> : null}{error ? <Notice type="error">{error}</Notice> : null}
    <Card>{withdrawals.length ? <div className="table-scroll"><table><thead><tr><th>Request</th><th>Host</th><th className="align-right">Amount</th><th>Payout method</th><th>Requested</th><th>Status</th>{canReview ? <th>Decision</th> : null}</tr></thead><tbody>{withdrawals.map((item) => <tr key={item.id}><td className="mono">{item.code}</td><td><b>{item.fullName}</b><small className="mono block">{item.externalUserId}</small></td><td className="align-right">{formatNumber(item.amount)} diamonds</td><td>{item.payout ?? "Not available"}</td><td>{formatDate(item.requestedAt)}</td><td><StatusBadge value={item.status} /></td>{canReview ? <td><form action={submitWithdrawalTransition} className="inline-review"><input type="hidden" name="withdrawalId" value={item.id} /><select name="nextStatus" defaultValue=""><option value="" disabled>Update…</option>{item.status === "PENDING" ? <><option value="UNDER_REVIEW">Under review</option><option value="REJECTED">Reject</option></> : null}{item.status === "UNDER_REVIEW" ? <><option value="APPROVED">Approve</option><option value="REJECTED">Reject</option></> : null}{item.status === "APPROVED" ? <option value="PROCESSING">Processing</option> : null}{item.status === "PROCESSING" ? <option value="COMPLETED">Completed</option> : null}</select><input name="reason" required placeholder="Reason" /><button type="submit" className="table-button" aria-label="Confirm withdrawal change"><Check size={15} /></button></form></td> : null}</tr>)}</tbody></table></div> : <EmptyState title="No withdrawal requests" detail="When an eligible earnings withdrawal is requested, it will appear here for the permitted reviewers." />}</Card>
    <p className="footnote"><Landmark size={14} />Approval is not completion. A request becomes completed only after the trusted payout flow confirms it.</p>
  </>;
}
