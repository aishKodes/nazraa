import "server-only";

import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { withTransaction } from "@/lib/db/transaction";
import { LiveAccessPolicyService } from "@/lib/services/live-access-policy";
import type { LiveKitPublishMode } from "@/lib/services/livekit-token-service";

type MediaRole =
  | "HOST"
  | "PASSIVE_VIEWER"
  | "AUDIO_REQUESTED"
  | "AUDIO_GUEST"
  | "PARTY_OWNER"
  | "PASSIVE_LISTENER"
  | "MIC_REQUESTED"
  | "RTC_SPEAKER";

/**
 * LiveKit access is intentionally separate from ZEGO's passive-RTC circuit
 * breaker. A LiveKit subscriber must receive a subscribe-only SFU token, but
 * it still goes through Nazraa membership, moderation, host approval and Live
 * eligibility checks before a publishing grant is created.
 */
export async function authorizeLiveKitRoom(
  identity: MobileIdentity,
  input: { roomCode: string; canPublish: boolean; ttlSeconds?: number },
) {
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & {
      room_id: string;
      room_type: "FACE" | "LIVE" | "PARTY";
      media_role: MediaRole;
      muted: number;
      room_status: string;
    })[]>(
      `SELECT room.id room_id, room.room_type, room.status room_status,
              member.media_role, member.muted
       FROM live_rooms room
       INNER JOIN live_room_members member
         ON member.room_id = room.id
        AND member.application_user_id = ?
        AND member.left_at IS NULL
       WHERE room.room_code = ? AND room.status IN ('ACTIVE','LOCKED')
       LIMIT 1 FOR UPDATE`,
      [identity.userId, input.roomCode],
    );
    const room = rows[0];
    if (!room) throw new Error("Join this active room before requesting media access.");

    const isHost = room.media_role === "HOST" || room.media_role === "PARTY_OWNER";
    const isAudioPublisher = room.media_role === "AUDIO_GUEST" || room.media_role === "RTC_SPEAKER";
    const mayPublish = isHost || isAudioPublisher;
    if (input.canPublish && (!mayPublish || Boolean(room.muted))) {
      throw new Error(room.room_type === "PARTY"
        ? "An active speaker role is required before microphone access."
        : "The host must accept your Audio Request before microphone access.");
    }
    if (input.canPublish) {
      const policy = LiveAccessPolicyService.for(identity);
      const access = room.room_type === "PARTY"
        ? policy.party
        : isHost ? policy.face : policy.chat;
      if (!access.allowed) throw new Error(access.reason);
    }

    const publishMode: LiveKitPublishMode = !input.canPublish
      ? "none"
      : room.room_type === "PARTY" || isAudioPublisher
        ? "audio_only"
        : "video_audio";
    const ttlSeconds = Math.max(300, Math.min(3600, input.ttlSeconds ?? 900));
    // The grant is audit/reconciliation evidence rather than a source of
    // truth for LiveKit. Expired/revoked grants never authorize a new token.
    await connection.execute(
      `UPDATE livekit_media_access_grants
       SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3))
       WHERE room_id = ? AND application_user_id = ? AND revoked_at IS NULL`,
      [room.room_id, identity.userId],
    );
    await connection.execute(
      `INSERT INTO livekit_media_access_grants
        (id, room_id, application_user_id, mobile_session_id, media_role,
         publish_mode, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3) + INTERVAL ? SECOND)`,
      [
        randomUUID(), room.room_id, identity.userId, identity.sessionId ?? null,
        room.media_role, publishMode, ttlSeconds,
      ],
    );
    return {
      roomId: room.room_id,
      roomCode: input.roomCode,
      roomType: room.room_type,
      mediaRole: room.media_role,
      publishMode,
      ttlSeconds,
    } as const;
  });
}

/**
 * PK never merges the two Nazraa rooms.  Each side retains its own chat,
 * audience and audio guests; this short-lived bridge permits only the current
 * participant to subscribe to the *opposing host* in the other LiveKit room.
 *
 * The receiving host may also subscribe to the opposing host microphone so
 * they can coordinate.  Spectators receive the opposing camera only.  No
 * guest microphone, data track, camera publishing, or arbitrary room token
 * is granted here.
 */
export async function authorizeLiveKitPkBridge(
  identity: MobileIdentity,
  input: { sessionId: string; roomCode: string; ttlSeconds?: number },
) {
  return withTransaction(async (connection) => {
    const [sessions] = await connection.query<(RowDataPacket & {
      status: string;
      source_room_id: string;
      source_room_code: string;
      source_host_public_id: string;
      target_room_id: string;
      target_room_code: string;
      target_host_public_id: string;
    })[]>(
      `SELECT session.status,
              source.id source_room_id, source.room_code source_room_code,
              source_host.public_id source_host_public_id,
              target.id target_room_id, target.room_code target_room_code,
              target_host.public_id target_host_public_id
       FROM live_pk_sessions session
       INNER JOIN live_rooms source ON source.id = session.source_room_id
       INNER JOIN application_users source_host
         ON source_host.id = source.host_application_user_id
       INNER JOIN live_rooms target ON target.id = session.target_room_id
       INNER JOIN application_users target_host
         ON target_host.id = target.host_application_user_id
       WHERE session.id = ? AND session.status = 'ACTIVE'
       LIMIT 1 FOR UPDATE`,
      [input.sessionId],
    );
    const session = sessions[0];
    if (!session) throw new Error("This PK battle is no longer active.");

    const localIsSource = session.source_room_code === input.roomCode;
    const localIsTarget = session.target_room_code === input.roomCode;
    if (!localIsSource && !localIsTarget) {
      throw new Error("This PK battle does not belong to the current room.");
    }
    const localRoomId = localIsSource
      ? session.source_room_id
      : session.target_room_id;
    const [members] = await connection.query<(RowDataPacket & {
      room_role: string;
      media_role: MediaRole;
      muted: number;
    })[]>(
      `SELECT room_role, media_role, muted
       FROM live_room_members
       WHERE room_id = ? AND application_user_id = ? AND left_at IS NULL
       LIMIT 1 FOR UPDATE`,
      [localRoomId, identity.userId],
    );
    const member = members[0];
    if (!member) {
      throw new Error("Join the active PK room before viewing the battle.");
    }

    const isHost = member.room_role === "OWNER" &&
      (member.media_role === "HOST" || member.media_role === "PARTY_OWNER");
    const ttlSeconds = Math.max(300, Math.min(900, input.ttlSeconds ?? 600));
    return {
      roomId: localIsSource ? session.target_room_code : session.source_room_code,
      remoteHostId: localIsSource
        ? session.target_host_public_id
        : session.source_host_public_id,
      receiveHostAudio: isHost,
      ttlSeconds,
    } as const;
  });
}
