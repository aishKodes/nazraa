import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
export async function partyRoomAdmins(
  identity: MobileIdentity,
  roomCode: string,
) {
  const [rooms] = await db().query<RowDataPacket[]>(
    "SELECT id FROM live_rooms WHERE room_code=? AND room_type='PARTY' AND status IN ('ACTIVE','LOCKED') AND host_application_user_id=?",
    [roomCode, identity.userId],
  );
  if (!rooms[0])
    throw new Error(
      "Only the Party Room Owner can manage persistent Room Admins.",
    );
  const [admins] = await db().query<RowDataPacket[]>(
    `SELECT u.public_id publicId,u.full_name name,a.granted_at grantedAt,m.left_at IS NULL present
    FROM party_room_admins a JOIN application_users u ON u.id=a.application_user_id
    LEFT JOIN live_room_members m ON m.room_id=a.room_id AND m.application_user_id=a.application_user_id
    WHERE a.room_id=? AND a.revoked_at IS NULL ORDER BY a.granted_at`,
    [rooms[0].id],
  );
  return {
    admins: admins.map((a) => ({ ...a, publicId: String(a.publicId) })),
  };
}
