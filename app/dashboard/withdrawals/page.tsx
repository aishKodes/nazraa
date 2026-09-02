import Image from "next/image";
import { Check, Download, ExternalLink, Landmark } from "lucide-react";
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
import { withdrawalFinance } from "@/lib/db/repositories/withdrawal-finance";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; page?: string; agencyId?: string }>;
}) {
  const scope = await requirePermission("withdrawals.read");
  const { error, success, page: rawPage, agencyId } = await searchParams;
  const canReview = can(scope.account.role, "withdrawals.review");
  const [result, payoutMethods, finance] = await Promise.all([
    listWithdrawalsPage(scope, {
      page: Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1),
    }),
    canReview ? listPayoutMethodReviews(scope) : Promise.resolve([]),
    withdrawalFinance(scope, agencyId),
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
      {finance.agencies.length ? (
        <>
          <div className="section-subheading">
            <h2>Agency earnings</h2>
            <p>Diamonds are withdrawable Host/Agency earnings. Commissions appear only after payment is completed.</p>
          </div>
          <Card>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Agency</th><th className="align-right">Hosts</th><th className="align-right">Available</th><th className="align-right">Completed diamonds</th><th className="align-right">Host payout</th><th className="align-right">Agency commission</th>{scope.account.role === "MASTER" ? <><th className="align-right">Super Admin</th><th className="align-right">Admin</th><th className="align-right">BD</th><th className="align-right">Country Manager</th><th className="align-right">Company</th></> : null}<th>Details</th></tr></thead>
                <tbody>{finance.agencies.map((agency) => <tr key={agency.id}>
                  <td><b>{agency.name}</b><small className="mono block">{agency.publicId}</small></td>
                  <td className="align-right">{formatNumber(agency.hostCount)}</td>
                  <td className="align-right">{formatNumber(agency.availableDiamonds)} diamonds</td>
                  <td className="align-right">{formatNumber(agency.totalWithdrawn)}</td>
                  <td className="align-right">{formatCurrency(agency.hostPayoutInr)}</td>
                  <td className="align-right">{formatCurrency(agency.agencyCommissionInr)}</td>
                  {scope.account.role === "MASTER" ? <>
                    <td className="align-right">{formatCurrency(agency.superAdminInr)}</td>
                    <td className="align-right">{formatCurrency(agency.adminInr)}</td>
                    <td className="align-right">{formatCurrency(agency.bdInr)}</td>
                    <td className="align-right">{formatCurrency(agency.countryManagerInr)}</td>
                    <td className="align-right">{formatCurrency(agency.companyInr)}</td>
                  </> : null}
                  <td><a className="table-link" href={`/dashboard/withdrawals?agencyId=${agency.id}`}>Open</a></td>
                </tr>)}</tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
      {finance.selectedAgency ? (
        <>
          <div className="section-subheading">
            <h2>{finance.selectedAgency.name} · Hosts</h2>
            <p>Current earnings, next withdrawal target, completed host payout, and Agency commission.</p>
            {scope.account.role === "MASTER" ? <a className="secondary-button" href={`/api/reports/agencies/${finance.selectedAgency.id}`}><Download size={15} />Download CSV</a> : null}
          </div>
          <Card>
            {finance.hosts.length ? <div className="table-scroll"><table>
              <thead><tr><th>Host</th><th className="align-right">Available diamonds</th><th className="align-right">Pending</th><th className="align-right">Next target</th><th className="align-right">Total withdrawn</th><th className="align-right">Host payout</th><th className="align-right">Agency commission</th></tr></thead>
              <tbody>{finance.hosts.map((host) => <tr key={host.id}>
                <td><div className="person">{host.avatarUrl ? <Image className="avatar" src={String(host.avatarUrl)} alt="" width={28} height={28} unoptimized /> : <span className="avatar">{host.name.slice(0, 1)}</span>}<span><b>{host.name}</b><small className="mono">{host.publicId}</small></span></div></td>
                <td className="align-right">{formatNumber(host.availableDiamonds)}</td>
                <td className="align-right">{formatNumber(host.pendingDiamonds)}</td>
                <td className="align-right">{formatNumber(host.nextTarget)}</td>
                <td className="align-right">{formatNumber(host.totalWithdrawn)}</td>
                <td className="align-right">{formatCurrency(host.hostPayoutInr)}</td>
                <td className="align-right">{formatCurrency(host.agencyCommissionInr)}</td>
              </tr>)}</tbody>
            </table></div> : <EmptyState title="No Hosts" detail="No active Host is assigned to this Agency." />}
          </Card>
          {finance.withdrawals.length ? <Card>
            <div className="card-title"><div><h2>Permanent payout breakdown</h2><p>The exact hierarchy, USD split, FX rate and INR amounts captured for every request.</p></div></div>
            <div className="table-scroll"><table>
              <thead><tr><th>Withdrawal</th><th>Host / hierarchy</th><th>Status</th><th className="align-right">Diamonds</th><th className="align-right">Host</th><th className="align-right">Agency</th><th className="align-right">SA</th><th className="align-right">Admin</th><th className="align-right">BD</th><th className="align-right">CM</th><th className="align-right">Company</th><th>FX / completed</th></tr></thead>
              <tbody>{finance.withdrawals.map((item) => <tr key={String(item.withdrawal_id)}>
                <td><b className="mono">{String(item.withdrawal_code)}</b><small className="block">{formatDate(item.requested_at as string)}</small></td>
                <td><b>{String(item.host_name)}</b><small className="mono block">{String(item.host_public_id)}</small><small className="block">{[item.agency_name, item.bd_name, item.admin_name, item.super_admin_name, item.country_manager_name].filter(Boolean).map(String).join(" → ") || "Unassigned"}</small></td>
                <td><StatusBadge value={String(item.status)} /></td>
                <td className="align-right">{formatNumber(Number(item.amount))}</td>
                <td className="align-right">{item.host_inr == null ? "Pending" : formatCurrency(Number(item.host_inr))}</td>
                <td className="align-right">{item.agency_inr == null ? "—" : formatCurrency(Number(item.agency_inr))}</td>
                <td className="align-right">{item.super_admin_inr == null ? "—" : formatCurrency(Number(item.super_admin_inr))}</td>
                <td className="align-right">{item.admin_inr == null ? "—" : formatCurrency(Number(item.admin_inr))}</td>
                <td className="align-right">{item.bd_inr == null ? "—" : formatCurrency(Number(item.bd_inr))}</td>
                <td className="align-right">{item.country_manager_inr == null ? "—" : formatCurrency(Number(item.country_manager_inr))}</td>
                <td className="align-right">{item.company_inr == null ? "—" : formatCurrency(Number(item.company_inr))}</td>
                <td>{item.usd_inr_rate == null ? "Not completed" : `$1 = ₹${Number(item.usd_inr_rate).toFixed(2)}`}<small className="block">{formatDate(item.completed_at as string | null)}</small></td>
              </tr>)}</tbody>
            </table></div>
          </Card> : null}
        </>
      ) : null}
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
