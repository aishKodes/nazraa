import { Ban, Radio } from "lucide-react";
import { submitTemporaryRestriction } from "@/app/actions";
import { submitRestoreLiveAccess, submitRoomStatus } from "@/app/admin-actions";
import { Pagination } from "@/components/pagination";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listPresenceIncidents, listRoomsPage } from "@/lib/db/repositories/operations";
import { formatDate, formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function RoomsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string; page?: string }> }) {
  const scope = await requirePermission("rooms.read");
  const { error, success, page: rawPage } = await searchParams;
  const [result, incidents] = await Promise.all([listRoomsPage(scope, { page: Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1) }), listPresenceIncidents(scope)]);
  const rooms = result.items;
  const mayRestrict = can(scope.account.role, "rooms.restrict");
  const mayManage = can(scope.account.role, "rooms.manage");
  return <>
    <SectionHeading title="Live rooms" description="Live and Party status in your branch. Every moderation action requires a reason and is audited." />
    {success ? <Notice type="success">{success}</Notice> : null}{error ? <Notice type="error">{error}</Notice> : null}
    <Card>{rooms.length ? <div className="table-scroll"><table><thead><tr><th>Room</th><th>Host</th><th>Type</th><th>Tools</th><th>Audience</th><th>Started</th><th>Status</th>{mayRestrict || mayManage ? <th>Moderation</th> : null}</tr></thead><tbody>{rooms.map((room) => <tr key={room.id}>
      <td data-label="Room" className="mono">{room.roomCode}</td>
      <td data-label="Host"><b>{room.hostName}</b><small className="mono block">{room.hostExternalId}</small></td>
      <td data-label="Type">{room.roomType}</td>
      <td data-label="Tools"><small className="block">{room.themeEnabled ? `Theme ${room.themeIndex + 1}` : "Theme off"} · {room.passwordProtected ? "Password" : "Open"} · {room.chatLocked ? "Chat locked" : "Chat open"}</small><small className="block">PK {room.pkRequestsEnabled ? `${room.pkCount} · requests on` : "requests off"} · Incidents {room.presenceIncidents}</small><small className="block"><b>Media {room.mixerStatus === "ACTIVE" ? "HYBRID" : "RTC FALLBACK"}</b> · RTC publishers {room.rtcPublishers} · Passive stream {room.passiveStreaming} · Passive RTC {room.passiveRtcFallback} · Mixer {room.mixerStatus}</small></td>
      <td data-label="Audience">{formatNumber(room.audience)}</td><td data-label="Started">{formatDate(room.startedAt)}</td><td data-label="Status"><StatusBadge value={room.status} /></td>
      {mayRestrict || mayManage ? <td data-label="Moderation"><div className="room-actions">
        {mayRestrict && room.status !== "ENDED" ? <details className="moderation"><summary><Ban size={14} />Restrict host</summary><form action={submitTemporaryRestriction}>
          <input type="hidden" name="applicationUserId" value={room.applicationUserId} /><input type="hidden" name="returnTo" value="rooms" />
          <select name="durationMinutes" defaultValue="30"><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option></select>
          <input name="reason" minLength={5} maxLength={500} required placeholder="Reason is required" /><label className="checkbox-line"><input type="checkbox" name="confirmed" value="yes" required />Confirm</label><button className="danger-button" type="submit">Apply restriction</button>
        </form></details> : null}
        {mayManage && room.status !== "ENDED" ? <details className="moderation"><summary>Room action</summary><form action={submitRoomStatus}>
          <input type="hidden" name="roomId" value={room.id} /><select name="status" required defaultValue=""><option value="" disabled>Choose</option>{room.status === "LOCKED" ? <option value="ACTIVE">Unlock room</option> : <option value="LOCKED">Lock room</option>}<option value="ENDED">End room</option></select>
          <input name="reason" minLength={5} required placeholder="Reason" /><label className="checkbox-line"><input type="checkbox" name="confirmed" value="yes" required />Confirm action</label><button className="danger-button" type="submit">Apply</button>
        </form></details> : null}
      </div></td> : null}
    </tr>)}</tbody></table></div> : <EmptyState title="No rooms active or recently recorded" detail="Live and Party rooms in this branch will appear here." />}<Pagination path="/dashboard/rooms" page={result.page} hasNext={result.hasNext} /></Card>

    <div className="section-subheading"><h2>Camera-presence history</h2><p>Only numeric detection results are recorded. No camera image is uploaded or retained.</p></div>
    <Card>{incidents.length ? <div className="table-scroll"><table><thead><tr><th>Host</th><th>Room</th><th>Event</th><th>Failures</th><th>Time</th><th>Live access</th></tr></thead><tbody>{incidents.map((incident) => <tr key={incident.id}>
      <td data-label="Host"><b>{incident.userName}</b><small className="mono block">{incident.userPublicId}</small></td><td data-label="Room"><span className="mono">{incident.roomCode}</span><small className="block">{incident.roomType}</small></td><td data-label="Event"><StatusBadge value={incident.incidentType} /></td><td data-label="Failures">{incident.consecutiveFailures}</td><td data-label="Time">{formatDate(incident.createdAt)}</td>
      <td data-label="Live access">{incident.restrictionId ? mayRestrict ? <details className="row-action"><summary>Restricted · review</summary><form action={submitRestoreLiveAccess}><input type="hidden" name="restrictionId" value={incident.restrictionId} /><input type="hidden" name="returnTo" value="rooms" /><input name="reason" minLength={5} maxLength={500} required placeholder="Restoration reason" /><button className="secondary-button" type="submit">Restore Live access</button></form></details> : <StatusBadge value="SUSPENDED" /> : <StatusBadge value="ACTIVE" />}</td>
    </tr>)}</tbody></table></div> : <EmptyState title="No camera-presence incidents" detail="Automatic Live stops will be listed here for authorized staff review." />}</Card>
    <p className="footnote"><Radio size={14} />Temporary restrictions automatically expire after 30, 60, or 120 minutes. Permanent bans are Master-only.</p>
  </>;
}
