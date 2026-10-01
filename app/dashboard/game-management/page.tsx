import { Card, EmptyState, Notice, SectionHeading } from "@/components/ui";
import { ReportControls, ReportPagination, type ReportFilters, reportQuery } from "@/components/report-controls";
import { requirePermission } from "@/lib/auth/guard";
import { formatIst, gameManagementReport, type ReportPageInput } from "@/lib/db/repositories/owner-reports";
import { formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function GameManagementPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const scope = await requirePermission("reports.export");
  const raw = await searchParams;
  const filters: ReportFilters = { q: typeof raw.q === "string" ? raw.q : "", period: raw.period === "24h" || raw.period === "custom" ? raw.period : "30d", from: typeof raw.from === "string" ? raw.from : "", to: typeof raw.to === "string" ? raw.to : "", page: Math.max(1, Number(raw.page) || 1) };
  const input: ReportPageInput = { ...filters };
  let data: Awaited<ReturnType<typeof gameManagementReport>> | null = null;
  let error = "";
  try { data = await gameManagementReport(scope, input); } catch (cause) { error = cause instanceof Error ? cause.message : "Report unavailable."; }
  const q = reportQuery(filters);
  const exportHref = `/api/reports/games?format=xlsx${q ? `&${q}` : ""}`;
  return <>
    <SectionHeading title="Game Management" description="Read-only game settlement and COIN-wallet reporting. Game outcomes and balances remain owned by the existing settlement ledger." />
    {error ? <Notice type="error">{error}</Notice> : null}
    <Card><ReportControls action="/dashboard/game-management" filters={filters} exportHref={exportHref} periods />
      {data?.summary.length ? <><div className="section-subheading"><h2>Player game summary</h2><p>Up to 100 matching players, aggregated only from real completed result rows. No Diamond-to-Coin conversion.</p></div><div className="table-scroll"><table><thead><tr><th>User</th><th>Current Coin balance</th><th>Played</th><th>Won</th><th>Lost</th><th>Coins bet</th><th>Coins won</th><th>Coins lost</th><th>Net</th></tr></thead><tbody>{data.summary.map((row) => <tr key={row.userId}><td data-label="User"><b>{row.userName}</b><small className="block">ID {row.userId}</small></td><td data-label="Current Coin balance">{formatNumber(row.currentCoinBalance)} Coins</td><td data-label="Played">{formatNumber(row.totalGamesPlayed)}</td><td data-label="Won">{formatNumber(row.totalGamesWon)}</td><td data-label="Lost">{formatNumber(row.totalGamesLost)}</td><td data-label="Coins bet">{formatNumber(row.totalCoinsBet)} Coins</td><td data-label="Coins won">{formatNumber(row.totalCoinsWon)} Coins</td><td data-label="Coins lost">{formatNumber(row.totalCoinsLost)} Coins</td><td data-label="Net">{row.netGameResult >= 0 ? "+" : "−"}{formatNumber(Math.abs(row.netGameResult))} Coins</td></tr>)}</tbody></table></div></> : null}
      <div className="section-subheading"><h2>Individual game history</h2><p>Only durable completed rounds are listed. Wallet-before is reconstructed from the canonical result&apos;s balance-after, wager and payout semantics.</p></div>
      {data?.items.length ? <div className="table-scroll"><table><thead><tr><th>Date/time (IST)</th><th>User</th><th>Game / Round</th><th>Wallet before</th><th>Bet</th><th>Result</th><th>Payout</th><th>Deduction / addition</th><th>Wallet after</th><th>Status</th></tr></thead><tbody>{data.items.map((row) => <tr key={row.resultId}><td data-label="Date/time (IST)">{formatIst(row.dateTime)}</td><td data-label="User">{row.userName}<small className="block">ID {row.userId}</small></td><td data-label="Game / Round"><b>{row.gameName}</b><small className="block mono">{row.roundId}</small></td><td data-label="Wallet before">{formatNumber(row.walletBefore)} Coins</td><td data-label="Bet">{formatNumber(row.betAmount)} Coins</td><td data-label="Result">{row.outcome}</td><td data-label="Payout">{formatNumber(row.payout)} Coins</td><td data-label="Deduction / addition">−{formatNumber(row.coinDeduction)} / +{formatNumber(row.coinAddition)} Coins<small className="block">Withheld {formatNumber(row.winningsDeduction)}</small></td><td data-label="Wallet after">{formatNumber(row.walletAfter)} Coins</td><td data-label="Status">{row.transactionStatus}</td></tr>)}</tbody></table></div> : <EmptyState title="No completed game rounds" detail="No durable game result rows match this date range and authorized scope." />}
      {data ? <ReportPagination action="/dashboard/game-management" filters={filters} page={data.page} hasNext={data.hasNext} /> : null}
    </Card>
  </>;
}
