import "server-only";

import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { withTransaction } from "@/lib/db/transaction";

export type LiveMediaUsageType =
  | "FACE_HOST_RTC"
  | "FACE_AUDIO_GUEST_RTC"
  | "FACE_PASSIVE_STREAM"
  | "FACE_PASSIVE_RTC_FALLBACK"
  | "PARTY_SPEAKER_RTC"
  | "PARTY_PASSIVE_STREAM"
  | "PARTY_PASSIVE_RTC_FALLBACK";

type MetricIncrement = {
  rtcVoiceSeconds?: number;
  rtcVideoSeconds?: number;
  facePassiveStreamSeconds?: number;
  partyPassiveStreamSeconds?: number;
  mixerCreationSeconds?: number;
  rtcPassiveFallbackSeconds?: number;
};

function incrementsFor(type: LiveMediaUsageType, seconds: number): MetricIncrement {
  if (seconds <= 0) return {};
  switch (type) {
    case "FACE_HOST_RTC":
    case "FACE_PASSIVE_RTC_FALLBACK":
      return {
        rtcVideoSeconds: seconds,
        ...(type === "FACE_PASSIVE_RTC_FALLBACK" ? { rtcPassiveFallbackSeconds: seconds } : {}),
      };
    case "FACE_AUDIO_GUEST_RTC":
    case "PARTY_SPEAKER_RTC":
      return { rtcVoiceSeconds: seconds };
    case "PARTY_PASSIVE_RTC_FALLBACK":
      return { rtcVoiceSeconds: seconds, rtcPassiveFallbackSeconds: seconds };
    case "FACE_PASSIVE_STREAM":
      return { facePassiveStreamSeconds: seconds };
    case "PARTY_PASSIVE_STREAM":
      return { partyPassiveStreamSeconds: seconds };
  }
}

async function updateDailyRow(
  connection: PoolConnection,
  increment: MetricIncrement,
  counts?: { rtcPassive: number; faceRtcPassive: number; concurrency: number },
) {
  const rtcVoice = Math.max(0, Math.floor(increment.rtcVoiceSeconds ?? 0));
  const rtcVideo = Math.max(0, Math.floor(increment.rtcVideoSeconds ?? 0));
  const faceStream = Math.max(0, Math.floor(increment.facePassiveStreamSeconds ?? 0));
  const partyStream = Math.max(0, Math.floor(increment.partyPassiveStreamSeconds ?? 0));
  const mixer = Math.max(0, Math.floor(increment.mixerCreationSeconds ?? 0));
  const fallback = Math.max(0, Math.floor(increment.rtcPassiveFallbackSeconds ?? 0));
  const currentRtcPassive = Math.max(0, Math.floor(counts?.rtcPassive ?? 0));
  const currentFaceRtcPassive = Math.max(0, Math.floor(counts?.faceRtcPassive ?? 0));
  const currentConcurrency = Math.max(0, Math.floor(counts?.concurrency ?? 0));
  await connection.execute(
    `INSERT INTO live_media_daily_metrics
      (usage_date, rtc_voice_seconds, rtc_video_seconds, face_passive_stream_seconds,
       party_passive_stream_seconds, mixer_creation_seconds, rtc_passive_fallback_seconds,
       rtc_passive_viewer_count, rtc_passive_viewer_peak,
       face_rtc_passive_viewer_count, face_rtc_passive_viewer_peak,
       media_concurrency_count, peak_concurrency)
     VALUES (CURRENT_DATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       rtc_voice_seconds = rtc_voice_seconds + VALUES(rtc_voice_seconds),
       rtc_video_seconds = rtc_video_seconds + VALUES(rtc_video_seconds),
       face_passive_stream_seconds = face_passive_stream_seconds + VALUES(face_passive_stream_seconds),
       party_passive_stream_seconds = party_passive_stream_seconds + VALUES(party_passive_stream_seconds),
       mixer_creation_seconds = mixer_creation_seconds + VALUES(mixer_creation_seconds),
       rtc_passive_fallback_seconds = rtc_passive_fallback_seconds + VALUES(rtc_passive_fallback_seconds),
       rtc_passive_viewer_count = VALUES(rtc_passive_viewer_count),
       rtc_passive_viewer_peak = GREATEST(rtc_passive_viewer_peak, VALUES(rtc_passive_viewer_peak)),
       face_rtc_passive_viewer_count = VALUES(face_rtc_passive_viewer_count),
       face_rtc_passive_viewer_peak = GREATEST(face_rtc_passive_viewer_peak, VALUES(face_rtc_passive_viewer_peak)),
       media_concurrency_count = VALUES(media_concurrency_count),
       peak_concurrency = GREATEST(peak_concurrency, VALUES(peak_concurrency))`,
    [rtcVoice, rtcVideo, faceStream, partyStream, mixer, fallback,
      currentRtcPassive, currentRtcPassive, currentFaceRtcPassive, currentFaceRtcPassive,
      currentConcurrency, currentConcurrency],
  );
}

async function activeCounts(connection: PoolConnection) {
  const [rows] = await connection.query<(RowDataPacket & {
    rtc_passive: number;
    face_rtc_passive: number;
    concurrency: number;
  })[]>(
    `SELECT
       SUM(usage_type IN ('FACE_PASSIVE_RTC_FALLBACK','PARTY_PASSIVE_RTC_FALLBACK')) rtc_passive,
       SUM(usage_type = 'FACE_PASSIVE_RTC_FALLBACK') face_rtc_passive,
       COUNT(*) concurrency
     FROM live_media_usage
     WHERE ended_at IS NULL
       AND last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 15 SECOND`,
  );
  return {
    rtcPassive: Number(rows[0]?.rtc_passive ?? 0),
    faceRtcPassive: Number(rows[0]?.face_rtc_passive ?? 0),
    concurrency: Number(rows[0]?.concurrency ?? 0),
  };
}

export async function recordMediaUsageHeartbeat(
  connection: PoolConnection,
  input: {
    roomId: string;
    applicationUserId: string;
    usageType?: LiveMediaUsageType;
    active: boolean;
    expectedFaceFallbackCeiling?: number;
  },
) {
  let deltaSeconds = 0;
  if (input.active && input.usageType) {
    const [previous] = await connection.query<(RowDataPacket & { delta_seconds: number })[]>(
      `SELECT IF(TIMESTAMPDIFF(SECOND, last_seen_at, CURRENT_TIMESTAMP(3)) BETWEEN 0 AND 10,
         TIMESTAMPDIFF(SECOND, last_seen_at, CURRENT_TIMESTAMP(3)), 0) delta_seconds
       FROM live_media_usage
       WHERE room_id = ? AND application_user_id = ? AND usage_type = ?
       LIMIT 1 FOR UPDATE`,
      [input.roomId, input.applicationUserId, input.usageType],
    );
    deltaSeconds = Number(previous[0]?.delta_seconds ?? 0);
    await connection.execute(
      `UPDATE live_media_usage SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3))
       WHERE room_id = ? AND application_user_id = ? AND usage_type <> ? AND ended_at IS NULL`,
      [input.roomId, input.applicationUserId, input.usageType],
    );
    await connection.execute(
      `INSERT INTO live_media_usage
        (room_id, application_user_id, usage_type, duration_seconds, first_seen_at, last_seen_at, ended_at)
       VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), NULL)
       ON DUPLICATE KEY UPDATE
         duration_seconds = duration_seconds + ?,
         last_seen_at = CURRENT_TIMESTAMP(3), ended_at = NULL`,
      [input.roomId, input.applicationUserId, input.usageType, deltaSeconds],
    );
  } else {
    await connection.execute(
      `UPDATE live_media_usage SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3))
       WHERE room_id = ? AND application_user_id = ? AND ended_at IS NULL`,
      [input.roomId, input.applicationUserId],
    );
  }

  const counts = await activeCounts(connection);
  await updateDailyRow(connection, input.usageType ? incrementsFor(input.usageType, deltaSeconds) : {}, counts);

  if (input.expectedFaceFallbackCeiling !== undefined) {
    const ceiling = Math.max(0, Math.floor(input.expectedFaceFallbackCeiling));
    if (counts.faceRtcPassive > ceiling) {
      await connection.execute(
        `INSERT INTO live_media_cost_alerts
          (id, usage_date, room_id, alert_code, observed_count, expected_ceiling, status)
         VALUES (?, CURRENT_DATE(), ?, 'FACE_RTC_PASSIVE_OVER_CEILING', ?, ?, 'OPEN')
         ON DUPLICATE KEY UPDATE observed_count = GREATEST(observed_count, VALUES(observed_count)),
           expected_ceiling = VALUES(expected_ceiling), status = 'OPEN',
           last_seen_at = CURRENT_TIMESTAMP(3), resolved_at = NULL`,
        [randomUUID(), input.roomId, counts.faceRtcPassive, ceiling],
      );
    } else {
      await connection.execute(
        `UPDATE live_media_cost_alerts SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP(3),
           last_seen_at = CURRENT_TIMESTAMP(3)
         WHERE usage_date = CURRENT_DATE() AND room_id = ?
           AND alert_code = 'FACE_RTC_PASSIVE_OVER_CEILING' AND status = 'OPEN'`,
        [input.roomId],
      );
    }
  }
}

export async function recordMixerUsageHeartbeat(roomCode: string) {
  await withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & {
      status: string;
      telemetry_at: Date | string | null;
    })[]>(
      `SELECT mixer.status, mixer.telemetry_at
       FROM live_media_mix_tasks mixer
       INNER JOIN live_rooms room ON room.id = mixer.room_id
       WHERE room.room_code = ? LIMIT 1 FOR UPDATE`,
      [roomCode],
    );
    const state = rows[0];
    if (!state) return;
    let deltaSeconds = 0;
    if (state.status === "ACTIVE" && state.telemetry_at) {
      const previous = new Date(state.telemetry_at).getTime();
      deltaSeconds = Math.max(0, Math.floor((Date.now() - previous) / 1000));
    }
    await connection.execute(
      `UPDATE live_media_mix_tasks
       SET telemetry_at = IF(status = 'ACTIVE', CURRENT_TIMESTAMP(3), NULL)
       WHERE room_id = (SELECT id FROM live_rooms WHERE room_code = ? LIMIT 1)`,
      [roomCode],
    );
    if (deltaSeconds > 0) {
      await updateDailyRow(connection, { mixerCreationSeconds: deltaSeconds });
    }
  });
}
