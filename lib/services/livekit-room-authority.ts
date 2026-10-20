import "server-only";

import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { withTransaction } from "@/lib/db/transaction";
import { LiveAccessPolicyService } from "@/lib/services/live-access-policy";
import { faceLiveSuspensionError } from "@/lib/services/face-live-suspension-error";
import type { LiveKitPublishMode } from "@/lib/services/livekit-token-service";
import { LiveKitRoomAdmin } from "@/lib/services/livekit-room-admin";

type PartyMicrophoneState = {roomCode: string; publicId: string; canPublish: boolean; muted: boolean};
/** Apply the latest Party capability, never a stale accept/leave action.
 * The same membership/room row lock serializes this short, bounded RPC against
 * seat changes. A late leave sync therefore cannot revoke a newly claimed seat.
 * Self-mute keeps the capability; staff mute revokes it. No remote unmute.
 */
export async function syncPartyMicrophone(
  roomCode: string,
  publicId: string,
  apply: (state: PartyMicrophoneState) => Promise<boolean> = async state => {
    const media = new LiveKitRoomAdmin(2);
    const permission = await media.setFaceAudioGuestPublishing(state.roomCode, state.publicId, state.canPublish);
    if (state.muted) await media.setParticipantAudioMuted(state.roomCode, state.publicId, true);
    return permission.changed;
  },
) {
  return withTransaction(async connection => {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT room.room_type,room.status,user.account_status,member.left_at,
        member.media_role,member.seat_index,member.muted,member.muted_by_staff
       FROM live_rooms room JOIN live_room_members member ON member.room_id=room.id
       JOIN application_users user ON user.id=member.application_user_id
       WHERE room.room_code=? AND user.public_id=? LIMIT 1 FOR UPDATE`, [roomCode,publicId]);
    const row=rows[0];
    if (!row || row.room_type!=='PARTY') return {isParty:false,applied:false};
    const canPublish = row.account_status==='ACTIVE' && ['ACTIVE','LOCKED'].includes(row.status)
      && row.left_at==null && !Boolean(row.muted_by_staff)
      && (row.media_role==='PARTY_OWNER' || (row.media_role==='RTC_SPEAKER' && row.seat_index!=null));
    const muted=Boolean(row.muted) || !canPublish;
    return {isParty:true,canPublish,muted,applied:await apply({roomCode,publicId,canPublish,muted})};
  });
}

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
    const [rows] = await connection.query<
      (RowDataPacket & {
        room_id: string;
        room_type: "FACE" | "LIVE" | "PARTY";
        media_role: MediaRole;
        muted: number;
        room_status: string;
      })[]
    >(
      `SELECT room.id room_id, room.room_type, room.status room_status,
              member.media_role, member.muted,member.muted_by_staff,member.seat_index
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
    if (!room)
      throw new Error("Join this active room before requesting media access.");

    const isHost =
      room.media_role === "HOST" || room.media_role === "PARTY_OWNER";
    const isAudioPublisher =
      room.media_role === "AUDIO_GUEST" || room.media_role === "RTC_SPEAKER";
    const mayPublish = isHost || (isAudioPublisher && (room.room_type!=='PARTY' || room.seat_index!=null));
    const publishingBlocked = room.room_type==='PARTY' ? Boolean(room.muted_by_staff) : Boolean(room.muted);
    if (input.canPublish && (!mayPublish || (room.room_type!=='PARTY' && publishingBlocked))) {
      throw new Error(
        room.room_type === "PARTY"
          ? "An active speaker role is required before microphone access."
          : "The host must accept your Audio Request before microphone access.",
      );
    }
    if (input.canPublish) {
      if (room.room_type !== "PARTY") {
        const [restrictions] = await connection.query<(RowDataPacket & {
          ends_at: Date | string;
          remaining_seconds: number;
        })[]>(
          `SELECT ends_at,
                  GREATEST(0, TIMESTAMPDIFF(SECOND, CURRENT_TIMESTAMP(3), ends_at)) remaining_seconds
           FROM moderation_restrictions
           WHERE application_user_id = ? AND restriction_type = 'FACE_LIVE'
             AND status = 'ACTIVE' AND ends_at > CURRENT_TIMESTAMP(3)
           ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
          [identity.userId],
        );
        if (restrictions[0]) {
          throw faceLiveSuspensionError(
            restrictions[0].ends_at,
            Number(restrictions[0].remaining_seconds),
          );
        }
      }
      const policy = LiveAccessPolicyService.for(identity);
      const access =
        room.room_type === "PARTY"
          ? policy.party
          : isHost
            ? policy.face
            : policy.chat;
      if (!access.allowed) throw new Error(access.reason);
    }

    const publishMode: LiveKitPublishMode = !input.canPublish || (room.room_type==='PARTY' && publishingBlocked)
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
    const publisherGrantId = randomUUID();
    await connection.execute(
      `INSERT INTO livekit_media_access_grants
        (id, room_id, application_user_id, mobile_session_id, media_role,
         publish_mode, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3) + INTERVAL ? SECOND)`,
      [
        publisherGrantId,
        room.room_id,
        identity.userId,
        identity.sessionId ?? null,
        room.media_role,
        publishMode,
        ttlSeconds,
      ],
    );
    return {
      publisherGrantId,
      roomId: room.room_id,
      roomCode: input.roomCode,
      roomType: room.room_type,
      mediaRole: room.media_role,
      publishMode,
      microphoneMuted: room.room_type==='PARTY' && Boolean(room.muted),
      ttlSeconds,
    } as const;
  });
}

/**
 * PK never merges the two Nazraa rooms.  Each side retains its own chat,
 * audience and audio guests; this short-lived bridge permits only the current
 * participant to subscribe to the *opposing host* in the other LiveKit room.
 *
 * Every member of each battling room receives the opposing main Host's
 * camera and microphone.  This is deliberately identity-scoped: no guest
 * microphone, data track, camera publishing, or arbitrary room token is
 * granted here.
 */
export async function authorizeLiveKitPkBridge(
  identity: MobileIdentity,
  input: { sessionId: string; roomCode: string; ttlSeconds?: number },
) {
  return withTransaction(async (connection) => {
    const [sessions] = await connection.query<
      (RowDataPacket & {
        status: string;
        source_room_id: string;
        source_room_code: string;
        source_host_public_id: string;
        target_room_id: string;
        target_room_code: string;
        target_host_public_id: string;
      })[]
    >(
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
    const [members] = await connection.query<
      (RowDataPacket & {
        room_role: string;
        media_role: MediaRole;
        muted: number;
      })[]
    >(
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

    const ttlSeconds = Math.max(300, Math.min(900, input.ttlSeconds ?? 600));
    return {
      roomId: localIsSource
        ? session.target_room_code
        : session.source_room_code,
      remoteHostId: localIsSource
        ? session.target_host_public_id
        : session.source_host_public_id,
      receiveHostAudio: true,
      ttlSeconds,
    } as const;
  });
}
