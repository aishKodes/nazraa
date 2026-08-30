import "server-only";

import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "@/lib/db/pool";
import { scopeWhere } from "@/lib/db/repositories/accounts";
import { withTransaction } from "@/lib/db/transaction";
import type { Scope } from "@/types/platform";

export async function searchMonitoring(scope: Scope, query: string) {
  const search = query.trim().slice(0, 120);
  if (!search) return [];
  const scoped = scopeWhere(scope, "u.agency_account_id");
  const exactId = /^\d{1,12}$/.test(search);
  const condition = exactId
    ? "(u.public_id = ? OR u.external_user_id = ? OR u.whatsapp_e164 LIKE ?)"
    : "(u.full_name LIKE ? OR u.whatsapp_e164 LIKE ? OR u.email LIKE ?)";
  const searchValues = exactId ? [Number(search), search, `${search}%`] : [`${search}%`, `${search}%`, `${search}%`];
  const [rows] = await db().query<(RowDataPacket & {
    id: string; public_id: number; external_user_id: string; full_name: string; whatsapp_e164: string | null;
    country_code: string | null; account_status: string; face_verification_status: string; is_host: number;
    host_status: string | null; verification_status: string | null; agency_name: string | null;
    room_code: string | null; room_type: string | null; room_status: string | null;
    restriction_id: string | null; restriction_ends_at: string | null; complaint_count: number; risk_count: number;
  })[]>(
    `SELECT u.id, u.public_id, u.external_user_id, u.full_name, u.whatsapp_e164, u.country_code,
            u.account_status, u.face_verification_status, u.is_host, host.status host_status,
            host.verification_status, agency.full_name agency_name,
            active_room.room_code, active_room.room_type, active_room.status room_status,
            restriction.id restriction_id, restriction.ends_at restriction_ends_at,
            COALESCE(complaints.complaint_count, 0) complaint_count,
            COALESCE(risks.risk_count, 0) risk_count
     FROM application_users u
     LEFT JOIN host_profiles host ON host.application_user_id = u.id
     LEFT JOIN platform_accounts agency ON agency.id = u.agency_account_id
     LEFT JOIN (
       SELECT room.host_application_user_id, room.room_code, room.room_type, room.status
       FROM live_rooms room
       INNER JOIN (
         SELECT host_application_user_id, MAX(started_at) started_at FROM live_rooms
         WHERE status IN ('ACTIVE','LOCKED') GROUP BY host_application_user_id
       ) latest ON latest.host_application_user_id = room.host_application_user_id AND latest.started_at = room.started_at
     ) active_room ON active_room.host_application_user_id = u.id
     LEFT JOIN moderation_restrictions restriction
       ON restriction.application_user_id = u.id AND restriction.status = 'ACTIVE'
      AND restriction.restriction_type IN ('TEMP_LIVE_BAN','SUSPENSION')
      AND (restriction.ends_at IS NULL OR restriction.ends_at > CURRENT_TIMESTAMP(3))
     LEFT JOIN (
       SELECT application_user_id, COUNT(*) complaint_count FROM support_tickets
       WHERE status NOT IN ('RESOLVED','CLOSED') GROUP BY application_user_id
     ) complaints ON complaints.application_user_id = u.id
     LEFT JOIN (
       SELECT application_user_id, COUNT(*) risk_count FROM risk_flags
       WHERE status != 'RESOLVED' GROUP BY application_user_id
     ) risks ON risks.application_user_id = u.id
     WHERE ${scoped.clause} AND ${condition}
     ORDER BY (u.external_user_id = ?) DESC, u.last_active_at DESC LIMIT 10`,
    [...scoped.values, ...searchValues, search],
  );
  return rows.map((row) => ({
    id: row.id, publicId: String(row.public_id), externalUserId: row.external_user_id, fullName: row.full_name,
    whatsapp: row.whatsapp_e164, country: row.country_code, status: row.account_status,
    faceStatus: row.face_verification_status, isHost: Boolean(row.is_host), hostStatus: row.host_status,
    verificationStatus: row.verification_status, agencyName: row.agency_name,
    roomCode: row.room_code, roomType: row.room_type, roomStatus: row.room_status,
    restrictionId: row.restriction_id, restrictionEndsAt: row.restriction_ends_at,
    complaintCount: Number(row.complaint_count), riskCount: Number(row.risk_count),
  }));
}

export async function listModerationHistory(scope: Scope, userIds: string[]) {
  if (!userIds.length) return [];
  const scoped = scopeWhere(scope, "u.agency_account_id");
  const placeholders = userIds.map(() => "?").join(",");
  const [rows] = await db().query<(RowDataPacket & {
    id: string; application_user_id: string; full_name: string; restriction_type: string; reason: string;
    status: string; starts_at: string; ends_at: string | null; actor_name: string;
  })[]>(
    `SELECT restriction.id, restriction.application_user_id, u.full_name, restriction.restriction_type,
            restriction.reason,
            CASE WHEN restriction.status = 'ACTIVE' AND restriction.ends_at <= CURRENT_TIMESTAMP(3) THEN 'EXPIRED' ELSE restriction.status END status,
            restriction.starts_at, restriction.ends_at, actor.full_name actor_name
     FROM moderation_restrictions restriction
     INNER JOIN application_users u ON u.id = restriction.application_user_id
     INNER JOIN platform_accounts actor ON actor.id = restriction.actor_account_id
     WHERE restriction.application_user_id IN (${placeholders}) AND ${scoped.clause}
     ORDER BY restriction.created_at DESC LIMIT 30`,
    [...userIds, ...scoped.values],
  );
  return rows.map((row) => ({
    id: row.id, applicationUserId: row.application_user_id, userName: row.full_name,
    type: row.restriction_type, reason: row.reason, status: row.status, startsAt: row.starts_at,
    endsAt: row.ends_at, actorName: row.actor_name,
  }));
}

export async function listUserDevices(scope: Scope, applicationUserId: string) {
  const scoped = scopeWhere(scope, "u.agency_account_id");
  const [rows] = await db().query<(RowDataPacket & {
    id: string; device_label: string | null; device_id_hash: string | null; last_used_at: string; expires_at: string; revoked_at: string | null;
    blocked_id: string | null; blocked_reason: string | null; blocked_at: string | null;
  })[]>(
    `SELECT session.id, session.device_label, session.device_id_hash, session.last_used_at, session.expires_at, session.revoked_at,
            block.id blocked_id, block.reason blocked_reason, block.blocked_at
     FROM mobile_sessions session
     INNER JOIN application_users u ON u.id = session.application_user_id
     LEFT JOIN mobile_device_blocks block ON block.mobile_session_id = session.id AND block.status = 'ACTIVE'
     WHERE session.application_user_id = ? AND ${scoped.clause}
     ORDER BY session.last_used_at DESC LIMIT 20`,
    [applicationUserId, ...scoped.values],
  );
  return rows.map((row) => ({
    id: row.id, label: row.device_label ?? "Unknown device", persistentDevice: Boolean(row.device_id_hash), lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at, revokedAt: row.revoked_at, blockId: row.blocked_id,
    blockReason: row.blocked_reason, blockedAt: row.blocked_at,
  }));
}

export async function blockUserDevice(input: { scope: Scope; sessionId: string; reason: string }) {
  if (!['MASTER', 'COUNTRY_MANAGER'].includes(input.scope.account.role)) throw new Error("Only Master or the assigned Country Manager can block a device.");
  if (input.reason.trim().length < 5) throw new Error("Provide a clear device block reason.");
  const scoped = scopeWhere(input.scope, "u.agency_account_id");
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { id: string; application_user_id: string; device_id_hash: string | null; device_label: string | null })[]>(
      `SELECT session.id, session.application_user_id, session.device_id_hash, session.device_label
       FROM mobile_sessions session INNER JOIN application_users u ON u.id = session.application_user_id
       WHERE session.id = ? AND ${scoped.clause} LIMIT 1 FOR UPDATE`,
      [input.sessionId, ...scoped.values],
    );
    const session = rows[0];
    if (!session) throw new Error("Device was not found in your permitted branch.");
    const blockId = randomUUID();
    await connection.execute(
      `INSERT INTO mobile_device_blocks
        (id, application_user_id, mobile_session_id, device_id_hash, device_label, reason, blocked_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [blockId, session.application_user_id, session.id, session.device_id_hash, session.device_label, input.reason.trim(), input.scope.account.id],
    );
    await connection.execute("UPDATE mobile_sessions SET revoked_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [session.id]);
    await connection.execute(
      `INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, new_data, reason)
       VALUES (?, ?, ?, 'device.block', 'devices', 'mobile_session', ?, ?, ?)`,
      [randomUUID(), input.scope.account.id, input.scope.account.role, session.id, JSON.stringify({ blockId, applicationUserId: session.application_user_id }), input.reason.trim()],
    );
  });
}

export async function unblockUserDevice(input: { scope: Scope; blockId: string; reason: string }) {
  if (!['MASTER', 'COUNTRY_MANAGER'].includes(input.scope.account.role)) throw new Error("Only Master or the assigned Country Manager can unblock a device.");
  if (input.reason.trim().length < 5) throw new Error("Provide a clear unblock reason.");
  const scoped = scopeWhere(input.scope, "u.agency_account_id");
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { id: string; mobile_session_id: string | null })[]>(
      `SELECT block.id, block.mobile_session_id FROM mobile_device_blocks block
       INNER JOIN application_users u ON u.id = block.application_user_id
       WHERE block.id = ? AND block.status = 'ACTIVE' AND ${scoped.clause} LIMIT 1 FOR UPDATE`,
      [input.blockId, ...scoped.values],
    );
    const block = rows[0];
    if (!block) throw new Error("Active device block was not found in your permitted branch.");
    await connection.execute("UPDATE mobile_device_blocks SET status = 'REVOKED', revoked_by = ?, revoked_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [input.scope.account.id, block.id]);
    await connection.execute(
      `INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, reason)
       VALUES (?, ?, ?, 'device.unblock', 'devices', 'mobile_session', ?, ?)`,
      [randomUUID(), input.scope.account.id, input.scope.account.role, block.mobile_session_id, input.reason.trim()],
    );
  });
}
