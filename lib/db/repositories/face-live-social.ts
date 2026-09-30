import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { db } from "@/lib/db/pool";
import { businessDateFor, loadFaceLiveRules } from "@/lib/services/live-business-policy";
import { roomRedis } from "@/lib/services/room-realtime-events";
import { publicApiOrigin } from "@/lib/config/public-api-origin";

/** Read-only social state. Money is derived exclusively from committed gifts. */
export async function faceLiveSocial(identity: MobileIdentity, roomCode: string, now: Date = new Date()) {
  const [rooms] = await db().query<RowDataPacket[]>(
    `SELECT room.id, room.host_application_user_id host_id, session.id session_id
     FROM live_rooms room JOIN live_room_members member ON member.room_id = room.id
       AND member.application_user_id = ? AND member.left_at IS NULL
     JOIN live_session_accounting session ON session.room_id = room.id
     WHERE room.room_code = ? AND room.room_type IN ('FACE','LIVE') AND room.status IN ('ACTIVE','LOCKED')`, [identity.userId, roomCode]);
  const room = rooms[0];
  if (!room) throw new Error("Join this Face Live to view its gifting activity.");
  const rules = await loadFaceLiveRules(db());
  const day = businessDateFor(rules.timezone, now);
  const month = `${day.slice(0, 7)}-01`;
  const redis = await roomRedis().catch(() => undefined);
  const epoch = await redis?.get(`face:social-version:${room.id}`).catch(() => null) ?? '0';
  const key = `face:social:${room.id}:${room.session_id}:${day}:${epoch}`;
  const cached = await redis?.get(key).catch(() => null);
  if (cached) return JSON.parse(cached) as Record<string, unknown>;
  const ranking = async (start: string, end: string) => {
    const [rows] = await db().query<RowDataPacket[]>(
      `SELECT user.public_id, user.full_name, user.avatar_url, avatar.updated_at avatar_updated_at,
         user.level_number, user.vip_tier, SUM(event.diamond_value) diamonds
       FROM live_room_gift_events event JOIN application_users user ON user.id = event.sender_application_user_id
       LEFT JOIN application_user_avatars avatar ON avatar.application_user_id = user.id
       WHERE event.face_host_application_user_id = ? AND event.receiver_application_user_id = ?
         AND event.business_date >= ? AND event.business_date <= ? AND event.diamond_value > 0
         AND user.account_status = 'ACTIVE'
       GROUP BY user.id, user.public_id, user.full_name, user.avatar_url, avatar.updated_at, user.level_number, user.vip_tier
       ORDER BY diamonds DESC, MIN(event.created_at), user.public_id LIMIT 5`, [room.host_id, room.host_id, start, end]);
    return rows.map((row) => ({ user: { id: String(row.public_id), name: row.full_name,
      avatarUrl: row.avatar_updated_at ? `${publicApiOrigin()}/api/v1/mobile/avatar/${row.public_id}?v=${new Date(row.avatar_updated_at).getTime()}` : row.avatar_url,
      level: Number(row.level_number), vip: Number(row.vip_tier) }, diamonds: Number(row.diamonds) }));
  };
  const [daily, monthly, sessionRows, contributions, admins] = await Promise.all([
    ranking(day, day), ranking(month, day),
    db().query<RowDataPacket[]>("SELECT COALESCE(SUM(diamond_value),0) diamonds FROM live_room_gift_events WHERE live_session_id = ? AND receiver_application_user_id = ?", [room.session_id, room.host_id]),
    db().query<RowDataPacket[]>(`SELECT user.public_id, SUM(event.diamond_value) diamonds, MAX(event.created_at) last_gift_at
      FROM live_room_gift_events event JOIN application_users user ON user.id = event.sender_application_user_id
      WHERE event.live_session_id = ? AND event.receiver_application_user_id = ?
      GROUP BY user.id, user.public_id ORDER BY diamonds DESC, last_gift_at DESC LIMIT 100`, [room.session_id, room.host_id]),
    db().query<RowDataPacket[]>("SELECT user.public_id FROM face_host_admins admin JOIN application_users user ON user.id = admin.admin_application_user_id WHERE admin.host_application_user_id = ?", [room.host_id]),
  ]);
  const result = { liveSessionId: room.session_id, businessDate: day, businessMonth: day.slice(0, 7),
    sessionDiamonds: Number(sessionRows[0][0].diamonds), daily, monthly,
    topFanId: monthly[0]?.user.id ?? null,
    contributions: contributions[0].map((row) => ({ userId: String(row.public_id), diamonds: Number(row.diamonds), lastGiftAt: row.last_gift_at })),
    adminIds: admins[0].map((row) => String(row.public_id)) };
  await redis?.set(key, JSON.stringify(result), { EX: 8 }).catch(() => undefined);
  return result;
}

/** Called after commit. Invalidate this room only; other Hosts are untouched. */
export async function invalidateFaceLiveSocial(roomCode: string) {
  const redis = await roomRedis().catch(() => undefined);
  if (!redis) return;
  const [rooms] = await db().query<RowDataPacket[]>("SELECT id FROM live_rooms WHERE room_code = ?", [roomCode]);
  if (!rooms[0]) return;
  // Epoch keys prevent an older in-flight read from re-populating the active
  // cache after a Gift committed. Old snapshots expire without a global scan.
  await redis.incr(`face:social-version:${rooms[0].id}`);
}
