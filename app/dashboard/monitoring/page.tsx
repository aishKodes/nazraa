import { Ban, Clock3, Laptop, Search, ShieldAlert } from "lucide-react";
import { submitDeviceBlock, submitDeviceUnblock, submitPermanentUserBan, submitTemporaryRestriction } from "@/app/actions";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listModerationHistory, listUserDevices, searchMonitoring } from "@/lib/db/repositories/monitoring";
import { formatDate } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function MonitoringPage({ searchParams }: {
  searchParams: Promise<{ q?: string; error?: string; success?: string }>;
}) {
  const scope = await requirePermission("monitoring.read");
  const { q = "", error, success } = await searchParams;
  const results = await searchMonitoring(scope, q);
  const [history, devices] = await Promise.all([
    listModerationHistory(scope, results.map((user) => user.id)),
    can(scope.account.role, "devices.read") && results.length === 1 ? listUserDevices(scope, results[0].id) : Promise.resolve([]),
  ]);
  const mayRestrict = can(scope.account.role, "rooms.restrict");
  const mayPermanentlyBan = can(scope.account.role, "users.permanent");
  const mayManageDevices = can(scope.account.role, "devices.manage");
  const isCs = scope.account.role === "MONITORING_CS";

  return <>
    <SectionHeading title="Monitoring / CS" description={isCs ? "Search a User or Host and apply only a temporary Live restriction. Account bans and device blocks are not available to CS." : "Search one User or Host ID, check their current status, and take only the permitted action."} />
    {success ? <Notice type="success">{success}</Notice> : null}{error ? <Notice type="error">{error}</Notice> : null}
    <Card className="monitor-search-card"><form className="filter-bar" action="/dashboard/monitoring"><label className="search-field"><Search size={18} /><input name="q" defaultValue={q} placeholder="User/Host ID, name, phone, or email" autoFocus /><button className="primary-button" type="submit">Search</button></label><span>{scope.isGlobal ? "Platform-wide" : "Your branch only"}</span></form></Card>

    {!q ? <Card><EmptyState title="Search a User or Host" detail="Use the exact ID for the quickest result. Access outside your branch is rejected by the server." /></Card> : results.length ? <div className="monitor-results">{results.map((user) => <Card key={user.id} className="monitor-user-card">
      <div className="card-title"><div><h2>{user.fullName}</h2><p className="mono">User ID {user.publicId}</p></div><StatusBadge value={user.status} /></div>
      <div className="monitor-facts">
        <span><small>Type</small><b>{user.isHost ? "Host" : "User"}</b></span><span><small>Agency</small><b>{user.agencyName ?? "Independent"}</b></span><span><small>Host status</small><b>{user.hostStatus ?? "—"}</b></span><span><small>Face verification</small><b>{user.faceStatus}</b></span><span><small>Complaints</small><b>{user.complaintCount}</b></span><span><small>Open risk flags</small><b>{user.riskCount}</b></span>
      </div>
      <div className="live-status"><span><Clock3 size={16} /><b>Current Live / Party</b></span>{user.roomCode ? <span><StatusBadge value={user.roomStatus ?? "ACTIVE"} /> {user.roomType} · <span className="mono">{user.roomCode}</span></span> : <span className="muted">Not currently live</span>}</div>
      {user.restrictionId ? <Notice type="error">Live restricted until {formatDate(user.restrictionEndsAt)}</Notice> : null}
      <div className="monitor-actions">
        {mayRestrict && !user.restrictionId && user.status !== "BANNED" ? <details className="moderation"><summary><Ban size={15} />Temporary Live block</summary><form action={submitTemporaryRestriction}><input type="hidden" name="applicationUserId" value={user.id} /><input type="hidden" name="returnTo" value="monitoring" /><select name="durationMinutes" defaultValue="30"><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option></select><input name="reason" minLength={5} maxLength={500} required placeholder="Reason" /><label className="checkbox-line"><input type="checkbox" name="confirmed" value="yes" required />Confirm</label><button className="danger-button" type="submit">Apply block</button></form></details> : null}
        {mayPermanentlyBan && user.status !== "BANNED" ? <details className="moderation permanent-action"><summary><ShieldAlert size={15} />Permanent ban</summary><form action={submitPermanentUserBan}><input type="hidden" name="applicationUserId" value={user.id} /><input name="reason" minLength={5} maxLength={500} required placeholder="Permanent-ban reason" /><input name="confirmation" pattern="BAN" required placeholder="Type BAN" /><button className="danger-button" type="submit">Permanently ban</button></form></details> : null}
      </div>
    </Card>)}</div> : <Card><EmptyState title="No user found" detail="Try an exact ID or a name/phone prefix. Results never cross your hierarchy branch." /></Card>}

    {history.length ? <><div className="section-subheading"><h2>Moderation history</h2><p>Recent restrictions for the matching users.</p></div><Card><div className="compact-list">{history.map((item) => <div key={item.id}><span><b>{item.userName} · {item.type.replaceAll("_", " ")}</b><small>{item.reason} · by {item.actorName}</small></span><span><StatusBadge value={item.status} /><small>{formatDate(item.startsAt)} → {formatDate(item.endsAt)}</small></span></div>)}</div></Card></> : null}

    {devices.length ? <><div className="section-subheading"><h2>Devices</h2><p>Only your branch is available. Older app versions without a device ID support session blocking only.</p></div><Card><div className="compact-list">{devices.map((device) => <div key={device.id}><span><b><Laptop size={15} />{device.label}</b><small>{device.persistentDevice ? "Persistent device control" : "Legacy app · this session only"} · Last used {formatDate(device.lastUsedAt)}{device.blockReason ? ` · ${device.blockReason}` : ""}</small></span>{mayManageDevices ? device.blockId ? <form action={submitDeviceUnblock} className="compact-action"><input type="hidden" name="blockId" value={device.blockId} /><input name="reason" minLength={5} required placeholder="Unblock reason" /><button className="secondary-button" type="submit">Unblock</button></form> : <form action={submitDeviceBlock} className="compact-action"><input type="hidden" name="sessionId" value={device.id} /><input name="reason" minLength={5} required placeholder="Block reason" /><label className="checkbox-line"><input type="checkbox" name="confirmed" value="yes" required />Confirm</label><button className="danger-button" type="submit">{device.persistentDevice ? "Block device" : "Block session"}</button></form> : <StatusBadge value={device.blockId ? "BLOCKED" : device.revokedAt ? "SIGNED OUT" : "ACTIVE"} />}</div>)}</div></Card></> : null}
  </>;
}
