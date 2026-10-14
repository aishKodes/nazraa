import Image from "next/image";
import Link from 'next/link';
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
import { withdrawalFinance,withdrawalCommissionTotals } from "@/lib/db/repositories/withdrawal-finance";
import { formatDate, formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; page?: string; agencyId?: string }>;
}) {
  const scope = await requirePermission("withdrawals.read");
  const { error, success, page: rawPage, agencyId } = await searchParams;
  const canReview = scope.account.role === 'MASTER' && can(scope.account.role, "withdrawals.review");
  const isAdmin=scope.account.role==='ADMIN';
  const [result, payoutMethods, finance,commissionTotals] = await Promise.all([
    listWithdrawalsPage(scope, {
      page: Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1),
    }),
    canReview ? listPayoutMethodReviews(scope) : Promise.resolve([]),
    withdrawalFinance(scope, agencyId),
    scope.account.role==='SUPER_ADMIN'?withdrawalCommissionTotals(scope):Promise.resolve(null),
  ]);
  const withdrawals = result.items;
  const dollars=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
  return (
    <>
      <SectionHeading
        title="Withdrawals"
        description="Review status separately from payment completion. Payout details are encrypted and every reveal is permission checked."
      />
      {success ? <Notice type="success">{success}</Notice> : null}
      {error ? <Notice type="error">{error}</Notice> : null}
      {scope.account.role==='MASTER'?<Card><h2>Agency-wise Withdrawal & Commission Summary</h2><p>Country → Agency → Host / transaction, saved commission totals, IST filters, Excel and CSV.</p><Link className="primary-button" href="/dashboard/withdrawals/summary">Open summary</Link></Card>:null}
      {commissionTotals?<div className="metric-grid"><Card><small>Total Host Commission · saved USD</small><h2>${Number(commissionTotals.host_usd).toFixed(2)}</h2></Card><Card><small>Total Agency Commission · saved USD</small><h2>${Number(commissionTotals.agency_usd).toFixed(2)}</h2></Card><Card><small>Completed Diamonds · entire authorized scope</small><h2>{formatNumber(Number(commissionTotals.completed_diamonds))}</h2></Card></div>:null}
      {finance.agencies.length ? (
        <>
          <div className="section-subheading">
            <h2>Agency earnings</h2>
            <p>Expected values use current configured whole-Host Diamond slabs. Paid values use saved USD snapshots. No mobile cash-out is enabled. Agency targets are unavailable unless canonically configured.</p>
          </div>
          <Card>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Agency</th><th className="align-right">Hosts</th><th className="align-right">Available Diamonds</th><th className="align-right">Completed Diamonds</th>{isAdmin?<><th>Total Coins</th><th>Submitted / Pending Diamonds</th><th>Total Dollar Work</th><th>Host Dollar</th><th>Agency Dollar</th><th>Target / achieved</th></>:<><th className="align-right">Host payout</th><th className="align-right">Agency commission</th></>}{scope.account.role === "MASTER" ? <><th className="align-right">Super Admin</th><th className="align-right">Admin</th><th className="align-right">BD</th><th className="align-right">Country Manager</th><th className="align-right">Company</th></> : null}<th>Details</th></tr></thead>
                <tbody>{finance.agencies.map((agency) => <tr key={agency.id}>
                  <td><b>{agency.name}</b><small className="mono block">{agency.publicId}</small></td>
                  <td className="align-right">{formatNumber(agency.hostCount)}</td>
                  <td className="align-right">{formatNumber(agency.availableDiamonds)} diamonds</td>
                  <td className="align-right">{formatNumber(agency.totalWithdrawn)}</td>
                  {isAdmin?<><td>{formatNumber(agency.availableCoins)}</td><td>{formatNumber(agency.pendingDiamonds)}</td><td>${agency.totalUsd.toFixed(2)}</td><td>${agency.hostUsd.toFixed(2)}</td><td>${agency.agencyUsd.toFixed(2)}</td><td>Canonical Agency target not configured</td></>:<><td className="align-right">{dollars(agency.hostUsd)}</td><td className="align-right">{dollars(agency.agencyUsd)}</td></>}
                  {scope.account.role === "MASTER" ? <>
                    <td className="align-right">{dollars(agency.superAdminUsd)}</td><td className="align-right">{dollars(agency.adminUsd)}</td><td className="align-right">{dollars(agency.bdUsd)}</td><td className="align-right">{dollars(agency.countryManagerUsd)}</td><td className="align-right">{dollars(agency.companyUsd)}</td>
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
          <Card><h2>{finance.selectedAgency.name} · expected withdrawal</h2><p>Current available balance estimate · saved requests across all periods. No new payout formula or Agency target is introduced.</p><div className="metric-grid"><div><small>Eligible whole-Host Diamonds</small><h3>{formatNumber(finance.selectedAgency.eligibleWithdrawalDiamonds)}</h3></div><div><small>Expected Host component</small><h3>{dollars(finance.selectedAgency.expected.host)}</h3></div><div><small>Expected Agency component</small><h3>{dollars(finance.selectedAgency.expected.agency)}</h3></div></div><div className="table-scroll"><table><thead><tr><th>Status</th><th>Requests</th><th>Submitted Diamonds</th><th>Expected Host USD</th><th>Expected Agency USD</th></tr></thead><tbody>{finance.selectedAgency.states.map(state=><tr key={state.status}><td><StatusBadge value={state.status}/></td><td>{state.requests}</td><td>{formatNumber(state.diamonds)}</td><td>{state.expected?dollars(state.expected.host):'Use paid snapshot below'}</td><td>{state.expected?dollars(state.expected.agency):'Use paid snapshot below'}</td></tr>)}</tbody></table></div><p>Expected amounts are not guarantees; completed payouts retain their original saved calculation. Agency target / achievement: not configured.</p></Card>
          <div className="section-subheading">
            <h2>{finance.selectedAgency.name} · Hosts</h2>
            <p>{isAdmin?'Current Diamonds, pending submissions, next configured withdrawal slab and saved Host USD. Assigned Agency targets are not configured.':'Current earnings, next withdrawal target, completed Host payout and Agency commission.'}</p>
            {scope.account.role === "MASTER" ? <a className="secondary-button" href={`/api/reports/agencies/${finance.selectedAgency.id}`}><Download size={15} />Download CSV</a> : null}
          </div>
          <Card>
            {finance.hosts.length ? <div className="table-scroll"><table>
              <thead><tr><th>Host</th><th className="align-right">Available diamonds</th><th className="align-right">Pending</th><th className="align-right">Next configured withdrawal slab</th><th className="align-right">Total withdrawn</th><th className="align-right">{isAdmin?'Host Dollar':'Host payout'}</th>{!isAdmin?<th className="align-right">Agency commission</th>:null}</tr></thead>
              <tbody>{finance.hosts.map((host) => <tr key={host.id}>
                <td><div className="person">{host.avatarUrl ? <Image className="avatar" src={String(host.avatarUrl)} alt="" width={28} height={28} unoptimized /> : <span className="avatar">{host.name.slice(0, 1)}</span>}<span><b>{host.name}</b><small className="mono">{host.publicId}</small></span></div></td>
                <td className="align-right">{formatNumber(host.availableDiamonds)}</td>
                <td className="align-right">{formatNumber(host.pendingDiamonds)}</td>
                <td className="align-right">{formatNumber(host.nextTarget)}</td>
                <td className="align-right">{formatNumber(host.totalWithdrawn)}</td>
                <td className="align-right">{dollars(host.hostUsd)}<small className="block">Expected {dollars(host.expected.host)}</small></td>
                {!isAdmin?<td className="align-right">{dollars(host.agencyUsd)}</td>:null}
              </tr>)}</tbody>
            </table></div> : <EmptyState title="No Hosts" detail="No active Host is assigned to this Agency." />}
          </Card>
          {finance.withdrawals.length ? <Card>
            <div className="card-title"><div><h2>Permanent payout breakdown</h2><p>The original hierarchy and saved USD allocations. Legacy FX/INR audit values remain in exports; historical records are not recalculated.</p></div></div>
            <div className="table-scroll"><table>
              <thead><tr><th>Withdrawal</th><th>Host / hierarchy</th><th>Status</th><th className="align-right">Diamonds</th><th className="align-right">{isAdmin?'Total Dollar Work':'Host'}</th>{isAdmin?<><th>Host Dollar</th><th>Agency Dollar</th></>:<><th className="align-right">Agency</th><th className="align-right">SA</th><th className="align-right">Admin</th><th className="align-right">BD</th><th className="align-right">CM</th><th className="align-right">Company</th></>}<th>Approved / processed / reference</th></tr></thead>
              <tbody>{finance.withdrawals.map((item) => <tr key={String(item.withdrawal_id)}>
                <td><b className="mono">{String(item.withdrawal_code)}</b><small className="block">{formatDate(item.requested_at as string)}</small></td>
                <td><b>{String(item.host_name)}</b><small className="mono block">{String(item.host_public_id)}</small><small className="block">{[item.agency_name, item.bd_name, item.admin_name, item.super_admin_name, item.country_manager_name].filter(Boolean).map(String).join(" → ") || "Unassigned"}</small></td>
                <td><StatusBadge value={String(item.status)} /></td>
                <td className="align-right">{formatNumber(Number(item.amount))}</td>
                <td className="align-right">{item.host_usd==null?'Not recorded':dollars(Number(isAdmin?item.total_usd:item.host_usd))}</td>
                {isAdmin?<><td>{item.host_usd==null?'Pending':`$${Number(item.host_usd).toFixed(2)}`}</td><td>{item.agency_usd==null?'Pending':`$${Number(item.agency_usd).toFixed(2)}`}</td></>:<>
                <td className="align-right">{item.agency_usd == null ? "—" : dollars(Number(item.agency_usd))}</td>
                <td className="align-right">{item.super_admin_usd == null ? "—" : dollars(Number(item.super_admin_usd))}</td>
                <td className="align-right">{item.admin_usd == null ? "—" : dollars(Number(item.admin_usd))}</td>
                <td className="align-right">{item.bd_usd == null ? "—" : dollars(Number(item.bd_usd))}</td>
                <td className="align-right">{item.country_manager_usd == null ? "—" : dollars(Number(item.country_manager_usd))}</td>
                <td className="align-right">{item.company_usd == null ? "—" : dollars(Number(item.company_usd))}</td>
                </>}
                <td><small className="block">Approved: {formatDate(item.approved_at as string|null)}</small><small className="block">Processed: {formatDate(item.completed_at as string | null)}</small><small className="mono">{String(item.provider_reference??'—')}</small></td>
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
