import { Coins, Users, ArrowLeftRight } from "lucide-react";
import { Card, EmptyState, MetricCard, Notice, SectionHeading } from "@/components/ui";
import { ReportControls, ReportPagination, type ReportFilters } from "@/components/report-controls";
import { requirePermission } from "@/lib/auth/guard";
import { coinTransferHistory, formatIst, type CoinTransferInput } from "@/lib/db/repositories/owner-reports";
import { formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function CoinTransfersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const scope = await requirePermission("coins.transfer");
  const raw = await searchParams;
  const mode = raw.mode === "date" ? "date" : "24h";
  const filters: ReportFilters = { q: typeof raw.q === "string" ? raw.q : "", mode, date: typeof raw.date === "string" ? raw.date : "", page: Math.max(1, Number(raw.page) || 1) };
  const input: CoinTransferInput = { ...filters };
  let data: Awaited<ReturnType<typeof coinTransferHistory>> | null = null;
  let error = "";
  try { data = await coinTransferHistory(scope, input); } catch (cause) { error = cause instanceof Error ? cause.message : "History unavailable."; }
  return <>
    <SectionHeading title="Coin Transfer History" description="Transfers made by your signed-in Coin Seller account only. Amounts remain Coins; this history does not show payment values or conversions." />
    {error ? <Notice type="error">{error}</Notice> : null}
    <div className="metric-grid"><MetricCard label="Transfers" value={data?.summary.totalTransfers ?? 0} icon={<ArrowLeftRight size={20} />} /><MetricCard label="Coins transferred" value={`${formatNumber(data?.summary.totalCoinsTransferred ?? 0)} Coins`} icon={<Coins size={20} />} /><MetricCard label="Recipients in result" value={data?.summary.recipientCount ?? 0} icon={<Users size={20} />} /></div>
    {data?.summary.userId ? <Notice>Recipient: {data.summary.userName} · User ID {data.summary.userId}.</Notice> : null}
    <Card><ReportControls action="/dashboard/coin-transfers" filters={filters} />
      {data?.items.length ? <div className="table-scroll"><table><thead><tr><th>User</th><th>Coins transferred</th><th>Transfer date/time (IST)</th><th>Transaction ID</th><th>Status</th></tr></thead><tbody>{data.items.map((row) => <tr key={row.id}><td data-label="User"><b>{row.userName}</b><small className="block">User ID {row.userId}</small><small className="block mono">{row.externalUserId}</small></td><td data-label="Coins transferred">{formatNumber(row.amount)} Coins</td><td data-label="Transfer date/time (IST)">{formatIst(row.createdAt)}</td><td data-label="Transaction ID" className="mono">{row.transactionId}</td><td data-label="Status">{row.status}</td></tr>)}</tbody></table></div> : <EmptyState title="No Coin transfers" detail="No real completed transfers match this seller, recipient filter and date mode." />}
      {data ? <ReportPagination action="/dashboard/coin-transfers" filters={filters} page={data.page} hasNext={data.hasNext} /> : null}
      <small className="muted block" style={{ marginTop: 12 }}>Supported filters: Last 24 Hours or Date Wise in Asia/Kolkata. Seller scope is enforced server-side; seller IDs in query parameters are ignored.</small>
    </Card>
  </>;
}
