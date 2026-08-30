import Link from "next/link";
import { Network, UserCog } from "lucide-react";
import { submitHierarchyReassignment } from "@/app/admin-actions";
import { Card, EmptyState, Notice, SectionHeading } from "@/components/ui";
import { HierarchyTree } from "@/components/hierarchy-tree";
import { requirePermission } from "@/lib/auth/guard";
import { hierarchy } from "@/lib/db/repositories/directory";
import { listPlatformAccounts } from "@/lib/db/repositories/administration";

export const dynamic = "force-dynamic";

export default async function HierarchyPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const scope = await requirePermission("hierarchy.read");
  const [{ error, success }, accounts, platformAccounts] = await Promise.all([searchParams, hierarchy(scope), scope.account.role === "MASTER" ? listPlatformAccounts(scope) : Promise.resolve([])]);
  const movable = platformAccounts.filter((account) => account.role !== "MASTER");
  const parents = platformAccounts.filter((account) => ["MASTER", "COUNTRY_MANAGER", "SUPER_ADMIN", "ADMIN", "BD"].includes(account.role) && account.status === "ACTIVE");
  return <><SectionHeading title="Hierarchy" description="Master → Country Manager → Super Admin → Admin/BD → Agency → Host/User. Coin Sellers sit under their assigned branch." action={<span className="scope-lock"><Network size={15} />{scope.isGlobal ? "Entire platform" : "Your branch only"}</span>} />
    {success ? <Notice type="success">{success}</Notice> : null}{error ? <Notice type="error">{error}</Notice> : null}
    {scope.account.role === "MASTER" ? <Card className="create-panel"><details><summary><span><UserCog size={18} /><b>Manage hierarchy</b></span><small>Create or reassign a branch with an audit reason.</small></summary><div className="admin-form"><Link className="primary-button" href="/dashboard/accounts#create-account">Create a team account</Link><form action={submitHierarchyReassignment}><div className="form-grid"><label>Move node<select name="accountId" required defaultValue=""><option value="" disabled>Select account</option>{movable.map((account) => <option key={account.id} value={account.id}>{account.displayRole} · {account.name} · {account.code}</option>)}</select></label><label>New parent<select name="parentAccountId" required defaultValue=""><option value="" disabled>Select permitted parent</option>{parents.map((account) => <option key={account.id} value={account.id}>{account.displayRole} · {account.name} · {account.code}</option>)}</select></label><label>Audit reason<input name="reason" required minLength={5} maxLength={500} placeholder="Reason for hierarchy change" /></label><label className="checkbox-line"><input type="checkbox" name="confirmed" value="yes" required />Confirm hierarchy change</label></div><button className="primary-button" type="submit">Save hierarchy change</button></form></div></details></Card> : null}
    <Card>{accounts.length ? <HierarchyTree nodes={accounts} /> : <EmptyState title="No accounts visible" detail="Accounts created under this branch will appear here." />}</Card>
  </>;
}
