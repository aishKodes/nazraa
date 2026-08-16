import { BellRing, Plus } from "lucide-react";
import { submitNotification } from "@/app/admin-actions";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listNotifications } from "@/lib/db/repositories/catalog";
import { formatDate } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const scope = await requirePermission("notifications.read"); const { error, success } = await searchParams; const notifications = await listNotifications(); const manage = can(scope.account.role, "notifications.manage");
  return <><SectionHeading title="Notifications" description="Publish now or schedule an in-app notification for a specific role audience." action={manage ? <a className="primary-button" href="#new-notification"><Plus size={16} />New notification</a> : undefined} />{success ? <Notice type="success">{success}</Notice> : null}{error ? <Notice type="error">{error}</Notice> : null}
    {manage ? <Card className="create-panel"><details id="new-notification"><summary><span><BellRing size={18} /><b>Compose notification</b></span><small>Leave schedule empty to publish immediately.</small></summary><form action={submitNotification} className="admin-form"><div className="form-grid"><label>Title<input name="title" required maxLength={120} /></label><label>Audience<select name="audienceRole" defaultValue=""><option value="">All users</option><option value="HOST">Hosts</option><option value="AGENCY">Agencies</option><option value="COIN_SELLER">Coin sellers</option></select></label><label>Schedule<input name="scheduledAt" type="datetime-local" /></label><label className="span-two">Message<textarea name="message" required maxLength={500} rows={3} /></label><label>Action target<input name="actionTarget" placeholder="Optional app route" /></label></div><div className="form-submit"><span /><button className="primary-button" type="submit">Publish or schedule</button></div></form></details></Card> : null}
    <Card>{notifications.length ? <div className="table-scroll"><table><thead><tr><th>Notification</th><th>Audience</th><th>Status</th><th>Scheduled</th><th>Published</th></tr></thead><tbody>{notifications.map((item) => <tr key={item.id}><td><b>{item.title}</b><small className="block">{item.message}</small></td><td>{item.audienceRole?.replaceAll("_", " ") ?? "All users"}</td><td><StatusBadge value={item.status} /></td><td>{formatDate(item.scheduledAt)}</td><td>{formatDate(item.publishedAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No notifications" detail="Published and scheduled messages appear here." />}</Card>
  </>;
}
