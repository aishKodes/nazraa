import { Check, ExternalLink, Landmark } from "lucide-react";
import { submitWithdrawalTransition } from "@/app/actions";
import { submitPayoutMethodReview } from "@/app/admin-actions";
import { Pagination } from "@/components/pagination";
import {
  Card,
  EmptyState,
  Notice,
  SectionHeading,
  StatusBadge,
} from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listPayoutMethodReviews } from "@/lib/db/repositories/mobile-administration";
import { listWithdrawalsPage } from "@/lib/db/repositories/operations";
import { formatDate, formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; page?: string }>;
}) {
  const scope = await requirePermission("withdrawals.read");
  const { error, success, page: rawPage } = await searchParams;
  const canReview = can(scope.account.role, "withdrawals.review");
  const [result, payoutMethods] = await Promise.all([
    listWithdrawalsPage(scope, {
      page: Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1),
    }),
    canReview ? listPayoutMethodReviews(scope) : Promise.resolve([]),
  ]);
  const withdrawals = result.items;
  return (
    <>
      <SectionHeading
        title="Withdrawals"
        description="Review status separately from payment completion. Payout details are encrypted and every reveal is permission checked."
      />
      {success ? <Notice type="success">{success}</Notice> : null}
      {error ? <Notice type="error">{error}</Notice> : null}
      {canReview ? (
        <>
          <div className="section-subheading">
            <h2>Payout method review</h2>
            <p>
              Verify a private destination before a host can submit earnings for
              payout.
            </p>
          </div>
          <Card>
            {payoutMethods.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Method</th>
                      <th>Destination</th>
                      <th>Created</th>
                      <th>Status</th>
                      <th>Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payoutMethods.map((method) => (
                      <tr key={method.id}>
                        <td>
                          <b>{method.fullName}</b>
                          <small className="mono block">
                            {method.userPublicId}
                          </small>
                        </td>
                        <td>
                          {method.displayName}
                          <small className="block">{method.type}</small>
                        </td>
                        <td>
                          <a
                            className="table-link"
                            href={`/api/payout-methods/${method.id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {method.maskedDestination}{" "}
                            <ExternalLink size={13} />
                          </a>
                        </td>
                        <td>{formatDate(method.createdAt)}</td>
                        <td>
                          <StatusBadge
                            value={
                              method.verified && method.active
                                ? "VERIFIED"
                                : method.active
                                  ? "PENDING"
                                  : "REJECTED"
                            }
                          />
                        </td>
                        <td>
                          {method.active && !method.verified ? (
                            <form
                              action={submitPayoutMethodReview}
                              className="inline-review"
                            >
                              <input
                                type="hidden"
                                name="methodId"
                                value={method.id}
                              />
                              <select name="decision" defaultValue="" required>
                                <option value="" disabled>
                                  Decision…
                                </option>
                                <option value="VERIFIED">Verify</option>
                                <option value="REJECTED">Reject</option>
                              </select>
                              <input
                                name="reason"
                                minLength={5}
                                maxLength={500}
                                required
                                placeholder="Review reason"
                              />
                              <button type="submit" className="table-button">
                                Save
                              </button>
                            </form>
                          ) : (
                            <span className="muted">Reviewed</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="No payout methods"
                detail="Host payout methods submitted from mobile will appear here."
              />
            )}
          </Card>
        </>
      ) : null}
      <div className="section-subheading">
        <h2>Withdrawal requests</h2>
        <p>
          Completion requires a payout-provider reference and consumes the
          reserved server balance.
        </p>
      </div>
      <Card>
        {withdrawals.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Host</th>
                  <th className="align-right">Amount</th>
                  <th>Payout method</th>
                  <th>Requested</th>
                  <th>Status</th>
                  {canReview ? <th>Decision</th> : null}
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Request" className="mono">
                      {item.code}
                    </td>
                    <td data-label="Host">
                      <b>{item.fullName}</b>
                      <small className="mono block">
                        {item.externalUserId}
                      </small>
                    </td>
                    <td data-label="Amount" className="align-right">
                      {formatNumber(item.amount)} diamonds
                    </td>
                    <td data-label="Payout method">
                      {item.payout ?? "Not available"}
                    </td>
                    <td data-label="Requested">
                      {formatDate(item.requestedAt)}
                    </td>
                    <td data-label="Status">
                      <StatusBadge value={item.status} />
                    </td>
                    {canReview ? (
                      <td data-label="Decision">
                        <form
                          action={submitWithdrawalTransition}
                          className="withdrawal-review"
                        >
                          <input
                            type="hidden"
                            name="withdrawalId"
                            value={item.id}
                          />
                          <select name="nextStatus" defaultValue="" required>
                            <option value="" disabled>
                              Update…
                            </option>
                            {item.status === "PENDING" ? (
                              <>
                                <option value="UNDER_REVIEW">
                                  Under review
                                </option>
                                <option value="APPROVED">Approve</option>
                                <option value="REJECTED">Reject</option>
                              </>
                            ) : null}
                            {item.status === "UNDER_REVIEW" ? (
                              <>
                                <option value="APPROVED">Approve</option>
                                <option value="REJECTED">Reject</option>
                              </>
                            ) : null}
                            {item.status === "APPROVED" ? (
                              <>
                                <option value="PROCESSING">Processing</option>
                                <option value="CANCELLED">Cancel</option>
                              </>
                            ) : null}
                            {item.status === "PROCESSING" ? (
                              <>
                                <option value="COMPLETED">Completed</option>
                                <option value="CANCELLED">Cancel</option>
                              </>
                            ) : null}
                          </select>
                          <input
                            name="providerReference"
                            maxLength={120}
                            placeholder="Provider ref (completion)"
                          />
                          <input name="reason" required placeholder="Reason" />
                          <label className="checkbox-line">
                            <input
                              type="checkbox"
                              name="confirmed"
                              value="yes"
                              required
                            />
                            Confirm
                          </label>
                          <button
                            type="submit"
                            className="table-button"
                            aria-label="Save withdrawal change"
                          >
                            <Check size={15} />
                          </button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No withdrawal requests"
            detail="When an eligible host submits a withdrawal, it will appear here for reviewers."
          />
        )}
        <Pagination
          path="/dashboard/withdrawals"
          page={result.page}
          hasNext={result.hasNext}
        />
      </Card>
      <p className="footnote">
        <Landmark size={14} />
        Approval is not completion. Completed means the provider reference was
        recorded and the reserved balance was consumed.
      </p>
    </>
  );
}
