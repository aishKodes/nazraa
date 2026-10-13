import "server-only";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { db } from "@/lib/db/pool";

export type RoomPresentation = { title: string; seatCount: number; themeIndex: number; themeEnabled: boolean };
export const audioSeatCounts = [8, 10, 20] as const; // Preserve the existing eight-seat legacy layout.
export function assertSafeAudioLayout(seatCount: number, occupiedIndexes: number[]) {
  if (!(audioSeatCounts as readonly number[]).includes(seatCount)) throw new Error("Choose an available room layout.");
  if (occupiedIndexes.some((index) => index >= seatCount)) throw new Error("Free the higher seats before choosing this layout. Nobody has been removed.");
}
export async function saveOwnerRoomProfile(connection: PoolConnection, ownerId: string, config: RoomPresentation) {
  await connection.execute(`INSERT INTO owner_room_profiles
    (owner_application_user_id, title, seat_count, theme_index, theme_enabled) VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE title=VALUES(title), seat_count=VALUES(seat_count), theme_index=VALUES(theme_index), theme_enabled=VALUES(theme_enabled)`,
    [ownerId, config.title, config.seatCount, config.themeIndex, config.themeEnabled]);
}
function presentation(row: RowDataPacket) {
  return { title: String(row.title), seatCount: Number(row.seat_count), themeIndex: Number(row.theme_index), themeEnabled: Boolean(row.theme_enabled) };
}
export async function ownerRoomProfile(identity: MobileIdentity) {
  const [profiles] = await db().query<RowDataPacket[]>("SELECT title, seat_count, theme_index, theme_enabled FROM owner_room_profiles WHERE owner_application_user_id = ?", [identity.userId]);
  if (profiles[0]) return { profile: presentation(profiles[0]) };
  // Existing Hosts need no reset/migration of their historical rooms.
  const [rooms] = await db().query<RowDataPacket[]>("SELECT title, seat_count, theme_index, theme_enabled FROM live_rooms WHERE host_application_user_id = ? AND room_type = 'PARTY' ORDER BY created_at DESC LIMIT 1", [identity.userId]);
  return { profile: rooms[0] ? presentation(rooms[0]) : null };
}
export async function roomPresentation(identity: MobileIdentity, roomCode: string) {
  const [rows] = await db().query<RowDataPacket[]>(`SELECT room.title, room.seat_count, room.theme_index, room.theme_enabled, room.config_version
    FROM live_rooms room JOIN live_room_members member ON member.room_id = room.id
      AND member.application_user_id = ? AND member.left_at IS NULL
    WHERE room.room_code = ? AND room.status IN ('ACTIVE','LOCKED')`, [identity.userId, roomCode]);
  if (!rows[0]) throw new Error("Join the room before viewing its settings.");
  return { roomCode, version: Number(rows[0].config_version), ...presentation(rows[0]) };
}
