import Link from "next/link";
import { Search, UserPlus } from "lucide-react";
import { Card, EmptyState, SectionHeading, StatusBadge } from "@/components/ui";
import { requirePermission } from "@/lib/auth/guard";
import { listUsers } from "@/lib/db/repositories/directory";
import { formatDate, formatNumber, initials } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const scope = await requirePermission("users.read");
  const { q } = await searchParams;
  const users = await listUsers(scope, q?.trim());
  return <>
    <SectionHeading title="Users" description="Search people, wallet snapshots, and membership without exposing sensitive identity details." action={<Link className="secondary-button" href="/dashboard/hosts"><UserPlus size={16} />Host applications</Link>} />
    <Card><form className="filter-bar" action="/dashboard/users"><label className="search-field"><Search size={17} /><input name="q" defaultValue={q} placeholder="Search by name or application user ID" /><button className="primary-button" type="submit">Search</button></label><span>{users.length} matching record{users.length === 1 ? "" : "s"}</span></form>
      {users.length ? <div className="table-scroll"><table><thead><tr><th>User</th><th>Country</th><th>Status</th><th>Level</th><th className="align-right">Coins</th><th className="align-right">Diamonds</th><th>Agency</th><th>Last active</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><div className="person"><span className="avatar">{initials(user.fullName)}</span><span><b>{user.fullName}</b><small className="mono">{user.externalUserId}</small></span></div></td><td>{user.countryCode ?? "—"}</td><td><StatusBadge value={user.status} /></td><td>{user.level}</td><td className="align-right">{formatNumber(user.coins)}</td><td className="align-right">{formatNumber(user.diamonds)}</td><td>{user.agencyName ?? "Independent"}</td><td>{formatDate(user.lastActiveAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No users found" detail="Try a different name or application user ID, or check the hierarchy scope." />}
    </Card>
  </>;
}
