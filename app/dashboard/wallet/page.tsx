import { Coins, Send } from "lucide-react";
import { submitCoinTransfer } from "@/app/actions";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { getRecentLedger } from "@/lib/db/repositories/dashboard";
import { listUsers } from "@/lib/db/repositories/directory";
import { formatDate, formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function WalletPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const scope = await requirePermission("wallet.read");
  const { error, success } = await searchParams;
  const [users, ledger] = await Promise.all([listUsers(scope), getRecentLedger(scope)]);
  const allowed = can(scope.account.role, "coins.transfer");
  return <>
    <SectionHeading title="Wallet & economy" description="Balances are snapshots. The immutable ledger is the financial source of truth." />
    {success ? <Notice type="success">{success}</Notice> : null}{error ? <Notice type="error">{error}</Notice> : null}
    <div className="split-grid">
      <Card className="transfer-card"><div className="card-title"><div><h2>Coin transfer</h2><p>Moves allocated inventory to one valid application user.</p></div><Coins size={20} /></div>
        {allowed ? <form action={submitCoinTransfer} className="stack-form"><label>Recipient<select name="recipientId" required defaultValue=""><option value="" disabled>Select a user in your scope</option>{users.map((user) => <option key={user.id} value={user.id}>{user.fullName} · {user.externalUserId}</option>)}</select></label><div className="two-fields"><label>Coins<input name="amount" inputMode="numeric" type="number" min="1" placeholder="e.g. 5000" required /></label><label>Reason<input name="reason" minLength={5} maxLength={500} placeholder="Why is this transfer needed?" required /></label></div><button className="primary-button" type="submit"><Send size={16} />Review and send</button><p className="form-note">The server locks both wallets, checks funds, writes debit and credit ledger entries, then records an audit event in one transaction.</p></form> : <EmptyState title="Transfers are not available" detail="Your role can view its economy records but cannot move coin inventory." />}
      </Card>
      <Card><div className="card-title"><div><h2>Transfer safeguards</h2><p>Small set of rules that keeps money operations dependable.</p></div></div><ul className="rule-list"><li>Recipient must be inside your hierarchy.</li><li>Whole positive coin amounts only.</li><li>Insufficient inventory stops the transfer.</li><li>Every change creates paired ledger records.</li><li>A reason and audit record are mandatory.</li></ul></Card>
    </div>
    <Card><div className="card-title"><div><h2>Recent ledger activity</h2><p>Latest financial records visible to your role.</p></div></div>{ledger.length ? <div className="table-scroll"><table><thead><tr><th>Code</th><th>Type</th><th>Destination</th><th className="align-right">Amount</th><th>Status</th><th>Recorded</th></tr></thead><tbody>{ledger.map((entry) => <tr key={entry.id}><td className="mono">{entry.transactionCode}</td><td>{entry.transactionType.replaceAll("_", " ")}</td><td>{entry.destinationName}</td><td className="align-right">{formatNumber(entry.amount)} {entry.assetType.toLowerCase()}s</td><td><StatusBadge value={entry.status} /></td><td>{formatDate(entry.createdAt)}</td></tr>)}</tbody></table></div> : <p className="quiet-empty">No finance records yet.</p>}</Card>
  </>;
}
