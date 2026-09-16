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
