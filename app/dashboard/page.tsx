import Link from "next/link";
import { ArrowRight, Building2, Coins, Landmark, Radio, UsersRound, WalletCards } from "lucide-react";
import { Card, MetricCard, SectionHeading, StatusBadge } from "@/components/ui";
import { requirePermission } from "@/lib/auth/guard";
import { getDashboardMetrics, getRecentActivity, getRecentLedger, getRevenueSeries } from "@/lib/db/repositories/dashboard";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const scope = await requirePermission("dashboard.read");
  const [metrics, activity, ledger, revenue] = await Promise.all([getDashboardMetrics(scope), getRecentActivity(scope), getRecentLedger(scope, 6), getRevenueSeries(scope)]);
  const max = Math.max(...revenue.map((item) => item.revenue), 1);
  return <>
    <SectionHeading title="Operations overview" description={scope.isGlobal ? "A clear view of the whole Nazraa platform." : `Everything inside ${scope.account.fullName}'s permitted branch.`} action={<span className="range-chip">Last 7 days</span>} />
    <div className="metric-grid">
      <MetricCard label="Users" value={metrics.users} detail="In your scope" icon={<UsersRound size={20} />} />
      <MetricCard label="Active hosts" value={metrics.hosts} detail="Approved or live" icon={<Radio size={20} />} />
      <MetricCard label="Active agencies" value={metrics.agencies} detail="Currently active" icon={<Building2 size={20} />} />
      <MetricCard label="Coin inventory" value={metrics.coinInventory} detail="Available only" icon={<Coins size={20} />} />
      <MetricCard label="Cash revenue" value={formatCurrency(metrics.revenue)} detail="Verified ledger entries" icon={<WalletCards size={20} />} />
      <MetricCard label="Pending withdrawals" value={metrics.pendingWithdrawals} detail="Needs a decision" icon={<Landmark size={20} />} />
    </div>
    <div className="dashboard-grid">
      <Card className="chart-card"><div className="card-title"><div><h2>Cash flow</h2><p>Revenue recorded in the trusted ledger</p></div><Link href="/dashboard/reports">Open report <ArrowRight size={15} /></Link></div>
        <div className="bar-chart" aria-label="Revenue over the last seven days">{revenue.length ? revenue.map((item) => <div className="bar-column" key={item.day}><span className="bar-value">{formatCurrency(item.revenue)}</span><div className="bar-track"><i style={{ height: `${Math.max(5, (item.revenue / max) * 100)}%` }} /></div><small>{new Intl.DateTimeFormat("en", { weekday: "short" }).format(new Date(item.day))}</small></div>) : <div className="chart-empty">No cash ledger entries in this period.</div>}</div>
      </Card>
      <Card className="activity-card"><div className="card-title"><div><h2>Recent activity</h2><p>Audited actions, newest first</p></div><Link href="/dashboard/audit">View all <ArrowRight size={15} /></Link></div>
        <div className="activity-list">{activity.length ? activity.map((item) => <div className="activity-row" key={item.id}><span className="activity-dot" /><div><b>{item.action.replaceAll(".", " ")}</b><p>{item.actorName} · {item.module}</p></div><time>{formatDate(item.createdAt)}</time></div>) : <p className="quiet-empty">Audit activity will appear here after the first operational action.</p>}</div>
      </Card>
    </div>
    <Card><div className="card-title"><div><h2>Latest transactions</h2><p>Only completed, auditable records appear here.</p></div><Link href="/dashboard/transactions">Transaction explorer <ArrowRight size={15} /></Link></div>
      {ledger.length ? <div className="table-scroll"><table><thead><tr><th>Transaction</th><th>Type</th><th>From</th><th>To</th><th className="align-right">Amount</th><th>Status</th><th>Time</th></tr></thead><tbody>{ledger.map((entry) => <tr key={entry.id}><td className="mono">{entry.transactionCode}</td><td>{entry.transactionType.replaceAll("_", " ")}</td><td>{entry.sourceName}</td><td>{entry.destinationName}</td><td className="align-right">{formatNumber(entry.amount)} {entry.assetType.toLowerCase()}s</td><td><StatusBadge value={entry.status} /></td><td>{formatDate(entry.createdAt)}</td></tr>)}</tbody></table></div> : <p className="quiet-empty">No ledger entries are visible in this scope yet.</p>}
    </Card>
  </>;
}
