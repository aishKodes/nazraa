import { Ban, Radio } from "lucide-react";
import { submitTemporaryRestriction } from "@/app/actions";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listRooms } from "@/lib/db/repositories/operations";
import { formatDate, formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function RoomsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const scope = await requirePermission("rooms.read");
  const { error, success } = await searchParams;
  const rooms = await listRooms(scope);
  const mayRestrict = can(scope.account.role, "rooms.restrict");
  return <><SectionHeading title="Live rooms" description="Monitoring refreshes from the room backend. Controls are deliberately limited and always auditable." />
    {success ? <Notice type="success">{success}</Notice> : null}{error ? <Notice type="error">{error}</Notice> : null}
    <Card>{rooms.length ? <div className="table-scroll"><table><thead><tr><th>Room</th><th>Host</th><th>Type</th><th className="align-right">Audience</th><th>Started</th><th>Status</th>{mayRestrict ? <th>Moderation</th> : null}</tr></thead><tbody>{rooms.map((room) => <tr key={room.id}><td className="mono">{room.roomCode}</td><td><b>{room.hostName}</b><small className="mono block">{room.hostExternalId}</small></td><td>{room.roomType}</td><td className="align-right">{formatNumber(room.audience)}</td><td>{formatDate(room.startedAt)}</td><td><StatusBadge value={room.status} /></td>{mayRestrict ? <td><details className="moderation"><summary><Ban size={14} />2-hour restriction</summary><form action={submitTemporaryRestriction}><input type="hidden" name="applicationUserId" value={room.applicationUserId} /><input name="reason" minLength={5} maxLength={500} required placeholder="Reason is required" /><button className="danger-button" type="submit">Apply restriction</button></form></details></td> : null}</tr>)}</tbody></table></div> : <EmptyState title="No rooms active or recently recorded" detail="Room monitoring becomes available as the live backend sends room events." />}</Card>
    <p className="footnote"><Radio size={14} />Monitoring/CS can apply a server-computed two-hour live restriction. This screen does not offer permanent bans.</p>
  </>;
}
