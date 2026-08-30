import Link from "next/link";
import { Search, UserPlus } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { Card, EmptyState, SectionHeading, StatusBadge } from "@/components/ui";
import { requirePermission } from "@/lib/auth/guard";
import { listUsersPage } from "@/lib/db/repositories/directory";
import { formatDate, formatNumber, initials } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const scope = await requirePermission("users.read");
  const { q, page: rawPage } = await searchParams;
  const result = await listUsersPage(scope, { search: q, page: Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1) });
  const users = result.items;
  return <>
    <SectionHeading title="Users" description="Search people, wallet snapshots, and membership without exposing sensitive identity details." action={<Link className="secondary-button" href="/dashboard/hosts"><UserPlus size={16} />Host applications</Link>} />
    <Card><form className="filter-bar" action="/dashboard/users"><label className="search-field"><Search size={17} /><input name="q" defaultValue={q} placeholder="Search ID, name, phone, or email" /><button className="primary-button" type="submit">Search</button></label><span>Page {result.page}</span></form>
      {users.length ? <div className="table-scroll"><table><thead><tr><th>User</th><th>Country</th><th>Status</th><th>Level</th><th className="align-right">Coins</th><th className="align-right">Diamonds</th><th>Agency</th><th>Last active</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td data-label="User"><div className="person"><span className="avatar">{initials(user.fullName)}</span><span><b>{user.fullName}</b><small className="mono">{user.externalUserId}</small></span></div></td><td data-label="Country">{user.countryCode ?? "—"}</td><td data-label="Status"><StatusBadge value={user.status} /></td><td data-label="Level">{user.level}</td><td data-label="Coins" className="align-right">{formatNumber(user.coins)}</td><td data-label="Diamonds" className="align-right">{formatNumber(user.diamonds)}</td><td data-label="Agency">{user.agencyName ?? "Independent"}</td><td data-label="Last active">{formatDate(user.lastActiveAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No users found" detail="Try a different ID, name, or phone, or check the hierarchy scope." />}
      <Pagination path="/dashboard/users" page={result.page} hasNext={result.hasNext} query={{ q }} />
    </Card>
  </>;
}
