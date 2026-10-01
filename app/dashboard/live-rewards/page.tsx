import { Clock3, Coins, Gift, Gem, Radio, CheckCircle2 } from "lucide-react";
import { Card, EmptyState, MetricCard, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { ReportControls, ReportPagination, type ReportFilters, reportQuery } from "@/components/report-controls";
import { requirePermission } from "@/lib/auth/guard";
import { formatIst, liveRewardReport, type ReportPageInput } from "@/lib/db/repositories/owner-reports";
import { formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function LiveRewardsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const scope = await requirePermission("reports.export");
  const raw = await searchParams;
  const filters: ReportFilters = { q: typeof raw.q === "string" ? raw.q : "", period: raw.period === "24h" || raw.period === "custom" ? raw.period : "30d", from: typeof raw.from === "string" ? raw.from : "", to: typeof raw.to === "string" ? raw.to : "", page: Math.max(1, Number(raw.page) || 1) };
  const input: ReportPageInput = { ...filters };
  let data: Awaited<ReturnType<typeof liveRewardReport>> | null = null;
  let error = "";
  try { data = await liveRewardReport(scope, input); } catch (cause) { error = cause instanceof Error ? cause.message : "Report unavailable."; }
  const q = reportQuery(filters);
  const exportHref = `/api/reports/live-rewards?format=xlsx${q ? `&${q}` : ""}`;
  const summary = data?.summary;
  return <>
    <SectionHeading title="Live Reward Monitoring" description="One row per canonical Face/Video Live session. Durations, eligibility, entitlements and credits come from the existing server ledger." />
    {error ? <Notice type="error">{error}</Notice> : null}
    <div className="metric-grid"><MetricCard label="Live sessions" value={summary?.totalLiveSessions ?? 0} icon={<Radio size={20} />} /><MetricCard label="Eligible live hours" value={summary?.totalLiveHours ?? 0} detail={`${formatNumber(summary?.totalLiveMinutes ?? 0)} eligible minutes`} icon={<Clock3 size={20} />} /><MetricCard label="Rewards earned" value={`${formatNumber(summary?.totalLiveRewards ?? 0)} Diamonds`} icon={<Gem size={20} />} /><MetricCard label="Claimed" value={`${formatNumber(summary?.totalClaimed ?? 0)} Diamonds`} icon={<CheckCircle2 size={20} />} /><MetricCard label="Credited" value={`${formatNumber(summary?.totalCredited ?? 0)} Diamonds`} icon={<Coins size={20} />} /><MetricCard label="Claimable" value={`${formatNumber(summary?.totalPending ?? 0)} Diamonds`} icon={<Gem size={20} />} /><MetricCard label="Gifts received" value={`${formatNumber(summary?.totalGiftingCoins ?? 0)} Coins`} detail={`${formatNumber(summary?.totalDiamondsReceived ?? 0)} Diamonds received`} icon={<Gift size={20} />} /></div>
    <Card><ReportControls action="/dashboard/live-rewards" filters={filters} exportHref={exportHref} periods />
      {data?.items.length ? <div className="table-scroll"><table><thead><tr><th>User / Host</th><th>Session</th><th>Start / End (IST)</th><th>Eligible time</th><th>Eligibility</th><th>Reward</th><th>Claim / credit</th><th>Gifts</th><th>Accounting</th></tr></thead><tbody>{data.items.map((row) => <tr key={row.sessionId}><td data-label="User / Host"><b>{row.userName}</b><small className="block">User {row.userId} · Host {row.hostId}</small></td><td data-label="Session" className="mono">{row.sessionId}<small className="block">{row.roomType}</small></td><td data-label="Start / End (IST)">{formatIst(row.startedAt)}<small className="block">End: {formatIst(row.endedAt)}</small></td><td data-label="Eligible time">{Math.floor(row.eligibleSeconds / 3600)}h {Math.floor((row.eligibleSeconds % 3600) / 60)}m {row.eligibleSeconds % 60}s<small className="block">{formatNumber(row.totalMinutes)} min · {row.totalHours} h</small></td><td data-label="Eligibility"><StatusBadge value={row.rewardEligibility} /></td><td data-label="Reward">{formatNumber(row.rewardDiamonds)} Diamonds</td><td data-label="Claim / credit"><StatusBadge value={row.claimStatus} /><small className="block">{row.rewardCreditStatus}</small>{row.claimedAt ? <small className="block">{formatIst(row.claimedAt)}</small> : null}</td><td data-label="Gifts">{formatNumber(row.giftingCoins)} Coins<small className="block">{formatNumber(row.diamondsReceived)} Diamonds</small></td><td data-label="Accounting"><StatusBadge value={row.accuracy} /><small className="block">{row.sessionStatus}</small></td></tr>)}</tbody></table></div> : <EmptyState title="No Live sessions" detail="No canonical Face/Video Live sessions match this time range and authorized scope." />}
      {data ? <ReportPagination action="/dashboard/live-rewards" filters={filters} page={data.page} hasNext={data.hasNext} /> : null}
    </Card>
  </>;
}
