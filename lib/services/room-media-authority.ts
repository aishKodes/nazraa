import "server-only";

import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { withTransaction } from "@/lib/db/transaction";
import { LiveAccessPolicyService } from "@/lib/services/live-access-policy";

type MediaRole =
  | "HOST"
  | "PASSIVE_VIEWER"
  | "AUDIO_REQUESTED"
  | "AUDIO_GUEST"
  | "PARTY_OWNER"
  | "PASSIVE_LISTENER"
  | "MIC_REQUESTED"
  | "RTC_SPEAKER";

function objectValue(value: unknown): Record<string, unknown> {
  if (Buffer.isBuffer(value)) {
    try { return JSON.parse(value.toString("utf8")) as Record<string, unknown>; } catch { return {}; }
  }
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function enabled(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

/**
 * Authorizes every RTC token, including non-publishing login tokens.
 * Passive Face/large-Party users receive no RTC token once the public stream
 * is active. The fallback ceiling prevents a CDN outage from silently moving
 * an unlimited audience onto billable RTC.
 */
export async function authorizeRoomRtc(
  identity: MobileIdentity,
  input: { roomCode: string; canPublish: boolean; ttlSeconds?: number },
) {
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & {
      room_id: string;
      room_type: "FACE" | "LIVE" | "PARTY";
      room_role: string;
      media_role: MediaRole;
      muted: number;
      room_features_json: unknown;
      mixer_status: string | null;
      mixer_output_stream_id: string | null;
    })[]>(
      `SELECT room.id room_id, room.room_type, member.room_role, member.media_role, member.muted,
              settings.setting_value room_features_json, mixer.status mixer_status,
              mixer.output_stream_id mixer_output_stream_id
       FROM live_rooms room
       INNER JOIN live_room_members member ON member.room_id = room.id
         AND member.application_user_id = ? AND member.left_at IS NULL
       LEFT JOIN system_settings settings ON settings.setting_key = 'mobile.room_features'
       LEFT JOIN live_media_mix_tasks mixer ON mixer.room_id = room.id
       WHERE room.room_code = ? AND room.status IN ('ACTIVE','LOCKED')
       LIMIT 1 FOR UPDATE`,
      [identity.userId, input.roomCode],
    );
    const room = rows[0];
    if (!room) throw new Error("Join this active room before requesting media access.");

    const features = objectValue(room.room_features_json);
    const threshold = Math.max(2, Math.min(200, Number(features.partyStreamingThreshold ?? 9)));
    const fallbackCeiling = Math.max(1, Math.min(100, Number(features.rtcPassiveFallbackCeiling ?? 3)));
    const temporaryCostGuardEnabled = features.temporaryRtcCostGuardEnabled !== false;
    const temporaryFaceViewerCeiling = Math.max(1, Math.min(20, Number(features.temporaryFaceRtcViewerCeiling ?? 3)));
    const temporaryPartyUserCeiling = Math.max(2, Math.min(100, Number(features.temporaryPartyRtcUserCeiling ?? 12)));
    const deploymentReady = process.env.ZEGO_STREAM_MIXING_READY === "true";
    const mixerConfigured = enabled(features.streamMixingEnabled) && deploymentReady;
    const [counts] = await connection.query<(RowDataPacket & { participant_count: number; passive_count: number })[]>(
      `SELECT COUNT(*) participant_count,
              SUM(media_role IN ('PASSIVE_VIEWER','AUDIO_REQUESTED','PASSIVE_LISTENER','MIC_REQUESTED')) passive_count
       FROM live_room_members
       WHERE room_id = ? AND left_at IS NULL
         AND last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 2 MINUTE`,
      [room.room_id],
    );
    const passiveCount = Number(counts[0]?.passive_count ?? 0);
    const streamingRequested = room.room_type !== "PARTY"
      ? features.facePassivePlaybackMode === "live_streaming"
      : room.room_type === "PARTY"
        ? features.partyPassivePlaybackMode === "live_streaming" && passiveCount >= threshold
        : false;
    const hasInteractiveOutput = Boolean(room.mixer_output_stream_id?.trim());
    const publicStreamActive = mixerConfigured && streamingRequested && room.mixer_status === "ACTIVE" && hasInteractiveOutput;
    const paidRoutingActive = enabled(features.paidMediaRoutingEnabled) && deploymentReady;
    const emergencyFallbackEnabled = enabled(features.emergencyRtcFallbackEnabled);

    const role = room.media_role;
    const isHost = role === "HOST" || role === "PARTY_OWNER";
    const isAudioPublisher = role === "AUDIO_GUEST" || role === "RTC_SPEAKER";
    const mayPublish = isHost || isAudioPublisher;
    if (input.canPublish && (!mayPublish || Boolean(room.muted))) {
      throw new Error(room.room_type !== "PARTY"
        ? "The host must accept your Audio Request before RTC microphone access."
        : "An active speaker role is required before RTC publishing.");
    }
    if (input.canPublish) {
      const policy = LiveAccessPolicyService.for(identity);
      const access = isHost
        ? room.room_type === "PARTY" ? policy.chat : policy.face
        : policy.chat;
      if (!access.allowed) throw new Error(access.reason);
    }

    const passiveRole = ["PASSIVE_VIEWER", "AUDIO_REQUESTED", "PASSIVE_LISTENER", "MIC_REQUESTED"].includes(role);
    if (!input.canPublish && passiveRole && publicStreamActive) {
      throw new Error("Passive audience media is delivered by the public Live stream; RTC access is not issued.");
    }

    // Refuse a second fresh RTC room for the same signed-in user or physical
    // device. Stale grants are revoked below so an interrupted join cannot
    // lock the person out indefinitely, but a live heartbeat must explicitly
    // leave before another room can start.
    const [otherRoomRows] = await connection.query<(RowDataPacket & { room_code: string })[]>(
      `SELECT other_room.room_code
       FROM live_media_access_grants grant_row
       INNER JOIN live_rooms other_room ON other_room.id = grant_row.room_id
       LEFT JOIN mobile_sessions grant_session ON grant_session.id = grant_row.mobile_session_id
       LEFT JOIN live_media_usage media_usage ON media_usage.room_id = grant_row.room_id
         AND media_usage.application_user_id = grant_row.application_user_id
         AND media_usage.ended_at IS NULL
         AND media_usage.last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 30 SECOND
       WHERE grant_row.room_id <> ? AND grant_row.revoked_at IS NULL
         AND grant_row.expires_at > CURRENT_TIMESTAMP(3)
         AND (grant_row.issued_at >= CURRENT_TIMESTAMP(3) - INTERVAL 45 SECOND
           OR media_usage.application_user_id IS NOT NULL)
         AND (grant_row.application_user_id = ?
           OR (? IS NOT NULL AND grant_session.device_id_hash = ?))
       LIMIT 1`,
      [room.room_id, identity.userId, identity.deviceIdHash ?? null, identity.deviceIdHash ?? null],
    );
    if (otherRoomRows[0]) {
      throw new Error(`Leave room ${otherRoomRows[0].room_code} before connecting to another Live room.`);
    }
    await connection.execute(
      `UPDATE live_media_access_grants grant_row
       LEFT JOIN mobile_sessions grant_session ON grant_session.id = grant_row.mobile_session_id
       SET grant_row.revoked_at = COALESCE(grant_row.revoked_at, CURRENT_TIMESTAMP(3))
       WHERE grant_row.room_id <> ? AND grant_row.revoked_at IS NULL
         AND grant_row.expires_at > CURRENT_TIMESTAMP(3)
         AND (grant_row.application_user_id = ?
           OR (? IS NOT NULL AND grant_session.device_id_hash = ?))`,
      [room.room_id, identity.userId, identity.deviceIdHash ?? null, identity.deviceIdHash ?? null],
    );
    await connection.execute(
      `UPDATE live_media_usage media_usage
       INNER JOIN live_media_access_grants grant_row ON grant_row.room_id = media_usage.room_id
         AND grant_row.application_user_id = media_usage.application_user_id
       LEFT JOIN mobile_sessions session_row ON session_row.id = grant_row.mobile_session_id
       SET media_usage.ended_at = COALESCE(media_usage.ended_at, CURRENT_TIMESTAMP(3))
       WHERE media_usage.room_id <> ? AND media_usage.ended_at IS NULL
         AND (media_usage.application_user_id = ?
           OR (? IS NOT NULL AND session_row.device_id_hash = ?))
         AND media_usage.last_seen_at < CURRENT_TIMESTAMP(3) - INTERVAL 30 SECOND`,
      [room.room_id, identity.userId, identity.deviceIdHash ?? null, identity.deviceIdHash ?? null],
    );

    // While the public stream is unavailable, the temporary cost guard is
    // deliberately independent from paidMediaRoutingEnabled. Previously the
    // fallback cap lived only inside the paid-routing branch, which allowed an
    // unlimited launch audience to receive billable RTC tokens while CDN was
    // still provisioning.
    if (temporaryCostGuardEnabled && !publicStreamActive) {
      const [activeGrantRows] = await connection.query<(RowDataPacket & {
        face_passive_users: number;
        party_rtc_users: number;
        current_user_active: number;
      })[]>(
        `SELECT
           COUNT(DISTINCT CASE WHEN transport = 'RTC_PASSIVE_FALLBACK'
             AND application_user_id <> ? THEN application_user_id END) face_passive_users,
           COUNT(DISTINCT CASE WHEN application_user_id <> ? THEN application_user_id END) party_rtc_users,
           MAX(application_user_id = ?) current_user_active
         FROM live_media_access_grants grant_row
         WHERE room_id = ? AND revoked_at IS NULL
           AND expires_at > CURRENT_TIMESTAMP(3)
           AND (issued_at >= CURRENT_TIMESTAMP(3) - INTERVAL 45 SECOND
             OR EXISTS (
               SELECT 1 FROM live_media_usage media_usage
               WHERE media_usage.room_id = grant_row.room_id
                 AND media_usage.application_user_id = grant_row.application_user_id
                 AND media_usage.ended_at IS NULL
                 AND media_usage.last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 30 SECOND
             ))`,
        [identity.userId, identity.userId, identity.userId, room.room_id],
      );
      const active = activeGrantRows[0];
      const currentUserActive = Boolean(Number(active?.current_user_active ?? 0));
      if (!currentUserActive && room.room_type !== "PARTY" && !input.canPublish && passiveRole) {
        const activeFaceViewers = Number(active?.face_passive_users ?? 0);
        if (activeFaceViewers >= temporaryFaceViewerCeiling) {
          throw new Error(`This Live temporarily supports ${temporaryFaceViewerCeiling} viewers while CDN activation finishes. Please retry shortly.`);
        }
      }
      if (!currentUserActive && room.room_type === "PARTY") {
        const activePartyUsers = Number(active?.party_rtc_users ?? 0);
        if (activePartyUsers >= temporaryPartyUserCeiling) {
          throw new Error(`This Party temporarily supports ${temporaryPartyUserCeiling} RTC members while streaming activation finishes. Please retry shortly.`);
        }
      }
    }
    // Paid routing is strict: a passive Face viewer never receives an RTC
    // token just because the public stream is still starting. A remotely
    // enabled emergency fallback is the only exception, and it is capped.
    if (!input.canPublish && passiveRole && paidRoutingActive && streamingRequested && !publicStreamActive) {
      if (!emergencyFallbackEnabled) {
        throw new Error("The public Live stream is starting. Passive RTC fallback is disabled; please retry shortly.");
      }
      const [fallbackRows] = await connection.query<(RowDataPacket & { active_fallbacks: number })[]>(
        `SELECT COUNT(DISTINCT application_user_id) active_fallbacks
         FROM live_media_access_grants
         WHERE room_id = ? AND transport = 'RTC_PASSIVE_FALLBACK'
           AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP(3)
           AND application_user_id <> ?`,
        [room.room_id, identity.userId],
      );
      const activeFallbacks = Number(fallbackRows[0]?.active_fallbacks ?? 0);
      if (activeFallbacks >= fallbackCeiling) {
        throw new Error("The emergency RTC fallback ceiling is reached. Please retry the public Live stream shortly.");
      }
    } else if (!input.canPublish && passiveRole && mixerConfigured && streamingRequested && passiveCount > fallbackCeiling) {
      // Compatibility guard before the paid-routing switch is activated.
      throw new Error("The safe RTC fallback audience limit is reached while the public Live stream starts. Please retry shortly.");
    }

    const ttlSeconds = Math.max(300, Math.min(7200, input.ttlSeconds ?? 3600));
    const streamId = input.canPublish ? `${input.roomCode}_${identity.publicId}_main` : null;
    // One active grant per user/room/transport prevents token retries from
    // looking like extra fallback viewers and keeps the guard deterministic.
    await connection.execute(
      `UPDATE live_media_access_grants
       SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3))
       WHERE room_id = ? AND application_user_id = ?
         AND revoked_at IS NULL`,
      [room.room_id, identity.userId],
    );
    await connection.execute(
      `INSERT INTO live_media_access_grants
        (id, room_id, application_user_id, mobile_session_id, media_role, transport, can_publish, stream_id, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3) + INTERVAL ? SECOND)`,
      [randomUUID(), room.room_id, identity.userId, identity.sessionId ?? null, role,
        input.canPublish ? "RTC_PUBLISHER" : "RTC_PASSIVE_FALLBACK",
        input.canPublish, streamId, ttlSeconds],
    );
    return {
      roomId: room.room_id,
      roomCode: input.roomCode,
      roomType: room.room_type,
      mediaRole: role,
      canPublish: input.canPublish,
      publishMode: input.canPublish
        ? room.room_type === "PARTY" || role === "AUDIO_GUEST" ? "audio_only" : "video_audio"
        : "none",
      streamId,
      ttlSeconds,
    } as const;
  });
}
