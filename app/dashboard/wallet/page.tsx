import { randomUUID } from "crypto";
import { Coins, Send } from "lucide-react";
import { submitCoinInventoryAdjustment, submitCoinTransfer, submitPlatformCoinAllocation } from "@/app/actions";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { getRecentLedger } from "@/lib/db/repositories/dashboard";
import { listPlatformAccounts } from "@/lib/db/repositories/administration";
import { listUsers } from "@/lib/db/repositories/directory";
import { formatDate, formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function WalletPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const scope = await requirePermission("wallet.read");
  const { error, success } = await searchParams;
  const canAllocate = can(scope.account.role, "coins.allocate");
  const allowed = can(scope.account.role, "coins.transfer");
  const [users, ledger, accounts] = await Promise.all([allowed ? listUsers(scope, undefined, 50) : Promise.resolve([]), getRecentLedger(scope), canAllocate ? listPlatformAccounts(scope) : Promise.resolve([])]);
  const idempotencyKey = randomUUID();
  const mintKey = randomUUID();
  const allocationKey = randomUUID();
  const inventoryAccounts = accounts.filter((account) => account.id !== scope.account.id && account.role !== "MASTER" && account.status === "ACTIVE");
  return <>
    <SectionHeading title="Wallet & economy" description="Balances are snapshots. The immutable ledger is the financial source of truth." />
    {success ? <Notice type="success">{success}</Notice> : null}{error ? <Notice type="error">{error}</Notice> : null}
    <div className="split-grid">
      <Card className="transfer-card"><div className="card-title"><div><h2>Coin transfer</h2><p>Moves allocated inventory to one valid application user.</p></div><Coins size={20} /></div>
        {allowed ? <form action={submitCoinTransfer} className="stack-form"><input type="hidden" name="idempotencyKey" value={idempotencyKey} /><label>Recipient<select name="recipientId" required defaultValue=""><option value="" disabled>Select a user in your scope</option>{users.map((user) => <option key={user.id} value={user.id}>{user.fullName} · {user.externalUserId}</option>)}</select></label><div className="two-fields"><label>Coins<input name="amount" inputMode="numeric" type="number" min="1" placeholder="e.g. 5000" required /></label><label>Reason<input name="reason" minLength={5} maxLength={500} placeholder="Why is this transfer needed?" required /></label></div><label className="checkbox-line"><input type="checkbox" name="confirmed" value="yes" required />Confirm this coin transfer</label><button className="primary-button" type="submit"><Send size={16} />Send coins</button><p className="form-note">The server locks both wallets, checks funds, writes debit and credit ledger entries, then records an audit event in one transaction.</p></form> : <EmptyState title="Transfers are not available" detail="Your role can view its economy records but cannot move coin inventory." />}
      </Card>
      <Card><div className="card-title"><div><h2>Transfer safeguards</h2><p>Small set of rules that keeps money operations dependable.</p></div></div><ul className="rule-list"><li>Recipient must be inside your hierarchy.</li><li>Whole positive coin amounts only.</li><li>Insufficient inventory stops the transfer.</li><li>Every change creates paired ledger records.</li><li>A reason and audit record are mandatory.</li></ul></Card>
    </div>
    {can(scope.account.role, "coins.mint") ? <Card className="inventory-card"><div className="card-title"><div><h2>Generate platform coins</h2><p>Master-only. Coins are generated into the Master wallet before distribution.</p></div></div><form action={submitCoinInventoryAdjustment} className="form-grid"><input type="hidden" name="idempotencyKey" value={mintKey} /><input type="hidden" name="accountId" value={scope.account.id} /><label>Action<select name="direction" defaultValue="ADD"><option value="ADD">Generate coins</option><option value="REMOVE">Remove unused coins</option></select></label><label>Coins<input name="amount" type="number" inputMode="numeric" min="1" required /></label><label>Reason<input name="reason" minLength={5} maxLength={500} required placeholder="Reason for supply change" /></label><label className="checkbox-line"><input type="checkbox" name="confirmed" value="yes" required />Confirm supply change</label><label>Finish<button className="primary-button" type="submit">Update platform inventory</button></label></form></Card> : null}
    {canAllocate ? <Card className="inventory-card"><div className="card-title"><div><h2>Distribute available inventory</h2><p>Moves coins from your wallet to an account below you. It never creates new coins.</p></div></div><form action={submitPlatformCoinAllocation} className="form-grid"><input type="hidden" name="idempotencyKey" value={allocationKey} /><label>Downstream account<select name="accountId" required defaultValue=""><option value="" disabled>Select account</option>{inventoryAccounts.map((account) => <option value={account.id} key={account.id}>{account.displayRole} · {account.name} · {account.code}</option>)}</select></label><label>Coins<input name="amount" type="number" inputMode="numeric" min="1" required /></label><label className="span-two">Reason<input name="reason" minLength={5} maxLength={500} required placeholder="Why is this allocation needed?" /></label><label className="checkbox-line"><input type="checkbox" name="confirmed" value="yes" required />Confirm allocation</label><label>Finish<button className="primary-button" type="submit">Allocate from my inventory</button></label></form></Card> : null}
    <Card><div className="card-title"><div><h2>Recent ledger activity</h2><p>Latest financial records visible to your role.</p></div></div>{ledger.length ? <div className="table-scroll"><table><thead><tr><th>Code</th><th>Type</th><th>Destination</th><th className="align-right">Amount</th><th>Status</th><th>Recorded</th></tr></thead><tbody>{ledger.map((entry) => <tr key={entry.id}><td className="mono">{entry.transactionCode}</td><td>{entry.transactionType.replaceAll("_", " ")}</td><td>{entry.destinationName}</td><td className="align-right">{formatNumber(entry.amount)} {entry.assetType.toLowerCase()}s</td><td><StatusBadge value={entry.status} /></td><td>{formatDate(entry.createdAt)}</td></tr>)}</tbody></table></div> : <p className="quiet-empty">No finance records yet.</p>}</Card>
  </>;
}
