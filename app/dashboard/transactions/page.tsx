import { Download } from "lucide-react";
import { Card, EmptyState, SectionHeading, StatusBadge } from "@/components/ui";
import { requirePermission } from "@/lib/auth/guard";
import { getRecentLedger } from "@/lib/db/repositories/dashboard";
import { formatDate, formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const scope = await requirePermission("transactions.read");
  const transactions = await getRecentLedger(scope, 100);
  return <><SectionHeading title="Transactions" description="An auditable explorer for ledger records. Balances cannot be edited from this screen." action={<a className="secondary-button" href="/api/reports/transactions"><Download size={16} />Download CSV</a>} />
    <Card>{transactions.length ? <div className="table-scroll"><table><thead><tr><th>Transaction code</th><th>Asset</th><th>Type</th><th>Source</th><th>Destination</th><th className="align-right">Amount</th><th>Status</th><th>Created</th></tr></thead><tbody>{transactions.map((entry) => <tr key={entry.id}><td className="mono">{entry.transactionCode}</td><td>{entry.assetType}</td><td>{entry.transactionType.replaceAll("_", " ")}</td><td>{entry.sourceName}</td><td>{entry.destinationName}</td><td className="align-right">{formatNumber(entry.amount)}</td><td><StatusBadge value={entry.status} /></td><td>{formatDate(entry.createdAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No transactions yet" detail="Completed coin transfers, sales, adjustments, and payouts will be listed here." />}</Card>
  </>;
}
