import { Download } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { Card, EmptyState, SectionHeading, StatusBadge } from "@/components/ui";
import { requirePermission } from "@/lib/auth/guard";
import { getLedgerPage } from "@/lib/db/repositories/dashboard";
import { formatDate, formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const scope = await requirePermission("transactions.read");
  const { page: rawPage } = await searchParams;
  const result = await getLedgerPage(scope, { page: Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1) });
  const transactions = result.items;
  return <><SectionHeading title="Transactions" description="An auditable explorer for ledger records. Balances cannot be edited from this screen." action={<a className="secondary-button" href="/api/reports/transactions"><Download size={16} />Download CSV</a>} />
    <Card>{transactions.length ? <div className="table-scroll"><table><thead><tr><th>Transaction code</th><th>Asset</th><th>Type</th><th>Source</th><th>Destination</th><th className="align-right">Amount</th><th>Status</th><th>Created</th></tr></thead><tbody>{transactions.map((entry) => <tr key={entry.id}><td data-label="Code" className="mono">{entry.transactionCode}</td><td data-label="Asset">{entry.assetType}</td><td data-label="Type">{entry.transactionType.replaceAll("_", " ")}</td><td data-label="Source">{entry.sourceName}</td><td data-label="Destination">{entry.destinationName}</td><td data-label="Amount" className="align-right">{formatNumber(entry.amount)}</td><td data-label="Status"><StatusBadge value={entry.status} /></td><td data-label="Created">{formatDate(entry.createdAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No transactions yet" detail="Completed coin transfers, sales, adjustments, and payouts will be listed here." />}<Pagination path="/dashboard/transactions" page={result.page} hasNext={result.hasNext} /></Card>
  </>;
}
