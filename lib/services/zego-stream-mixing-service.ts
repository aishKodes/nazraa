import "server-only";

import { createHash, randomBytes } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";

type RoomType = "FACE" | "LIVE" | "PARTY";

type MixInput = {
  StreamId: string;
  ContentControl: 0 | 1;
  RectInfo?: { Top: number; Left: number; Bottom: number; Right: number; Layer: number };
};

type MixerPlan = {
  roomId: string;
  roomCode: string;
  roomType: RoomType;
  taskId: string;
  outputStreamId: string;
  sequence: number;
  desiredHash: string;
  inputs: MixInput[];
  shouldRun: boolean;
  shouldStop: boolean;
};

function jsonObject(value: unknown): Record<string, unknown> {
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

function disabled(value: unknown) {
  return value === false || value === 0 || value === "0" || value === "false";
}

/**
 * Server-only ZEGO StartMix/StopMix adapter.
 *
 * The adapter is inert unless the deployment gate is explicitly enabled.
 * AppId and ServerSecret never leave the server and are never logged.
 */
class ZegoStreamMixingApi {
  private readonly appId = Number(process.env.ZEGO_APP_ID ?? 0);
  private readonly secret = process.env.ZEGO_SERVER_SECRET ?? "";
  private readonly ready = process.env.ZEGO_STREAM_MIXING_READY === "true";

  get isConfigured() {
    return this.ready && Number.isSafeInteger(this.appId) && this.appId > 0 && Buffer.byteLength(this.secret) === 32;
  }

  private endpoint(action: "StartMix" | "StopMix") {
    if (!this.isConfigured) throw new Error("ZEGO Stream Mixing is not activated for this deployment.");
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomBytes(8).toString("hex");
    const signature = createHash("md5")
      .update(`${this.appId}${nonce}${this.secret}${timestamp}`)
      .digest("hex");
    const query = new URLSearchParams({
      Action: action,
      AppId: String(this.appId),
      SignatureNonce: nonce,
      Timestamp: String(timestamp),
      Signature: signature,
      SignatureVersion: "2.0",
      IsTest: "false",
    });
    return `https://rtc-api.zego.im/?${query}`;
  }

  private async post(action: "StartMix" | "StopMix", body: Record<string, unknown>) {
    const response = await fetch(this.endpoint(action), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    const payload = await response.json() as {
      Code?: number;
      Message?: string;
      Data?: { PlayInfo?: { HLS?: string; FLV?: string; RTMP?: string }[] };
    };
    if (!response.ok || Number(payload.Code ?? -1) !== 0) {
      throw new Error(`ZEGO ${action} failed (${payload.Code ?? response.status}): ${payload.Message ?? "Unknown error"}`);
    }
    return payload;
  }

  start(plan: MixerPlan) {
    const video = plan.roomType !== "PARTY";
    const output: Record<string, unknown> = {
      StreamId: plan.outputStreamId,
      Width: video ? 720 : 1,
      Height: video ? 1280 : 1,
      VideoBitrate: video ? 1_500_000 : 1,
      Fps: video ? 20 : 1,
      AudioCodec: 1,
      AudioBitrate: 128_000,
      SoundChannel: 1,
    };
    const publishTemplate = process.env.ZEGO_CDN_PUBLISH_URL_TEMPLATE?.trim() ?? "";
    if (publishTemplate) {
      output.StreamUrl = publishTemplate.replaceAll("{streamId}", encodeURIComponent(plan.outputStreamId));
      delete output.StreamId;
    }
    return this.post("StartMix", {
      TaskId: plan.taskId,
      Sequence: plan.sequence,
      UserId: `mixer_${plan.roomId.replaceAll("-", "")}`,
      RoomId: plan.roomCode,
      MixInput: plan.inputs,
      MixOutput: [output],
    });
  }

  stop(plan: MixerPlan) {
    return this.post("StopMix", {
      TaskId: plan.taskId,
      Sequence: plan.sequence,
      UserId: `mixer_${plan.roomId.replaceAll("-", "")}`,
    });
  }
}

async function preparePlan(roomCode: string): Promise<MixerPlan | null> {
  const [rooms] = await db().query<(RowDataPacket & {
    id: string;
    room_code: string;
    room_type: RoomType;
    status: string;
    room_features_json: unknown;
    host_public_id: number;
    host_media_publishing: number;
  })[]>(
    `SELECT room.id, room.room_code, room.room_type, room.status,
            settings.setting_value room_features_json, host.public_id host_public_id,
            (COALESCE(accounting.media_publishing, FALSE)
              AND accounting.last_media_heartbeat_at >= CURRENT_TIMESTAMP(3) - INTERVAL 30 SECOND) host_media_publishing
     FROM live_rooms room
     INNER JOIN application_users host ON host.id = room.host_application_user_id
     LEFT JOIN live_session_accounting accounting ON accounting.room_id = room.id AND accounting.status = 'ACTIVE'
     LEFT JOIN system_settings settings ON settings.setting_key = 'mobile.room_features'
     WHERE room.room_code = ? LIMIT 1`,
    [roomCode],
  );
  const room = rooms[0];
  if (!room) return null;
  const features = jsonObject(room.room_features_json);
  const threshold = Math.max(2, Math.min(200, Number(features.partyStreamingThreshold ?? 9)));
  const featureEnabled = enabled(features.streamMixingEnabled);
  const playbackRequested = room.room_type === "PARTY"
    ? features.partyPassivePlaybackMode === "live_streaming"
    : features.facePassivePlaybackMode === "live_streaming";
  const pkCompositeEnabled = !disabled(features.pkCompositeStreamingEnabled);
  const [members] = await db().query<(RowDataPacket & {
    public_id: number;
    room_role: string;
    media_role: string;
    muted: number;
    media_publishing: number;
    publisher_room_code: string;
  })[]>(
    `SELECT user.public_id, member.room_role, member.media_role, member.muted, ? publisher_room_code,
            CASE WHEN member.media_role IN ('HOST','PARTY_OWNER') THEN ?
              ELSE (member.media_publishing
                AND member.last_media_heartbeat_at >= CURRENT_TIMESTAMP(3) - INTERVAL 30 SECOND)
            END media_publishing
     FROM live_room_members member
     INNER JOIN application_users user ON user.id = member.application_user_id
     WHERE member.room_id = ? AND member.left_at IS NULL
       AND member.last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 2 MINUTE
     ORDER BY member.room_role = 'OWNER' DESC, member.joined_at`,
    [room.room_code, room.host_media_publishing, room.id],
  );
  const audienceCount = members.filter((member) => member.room_role === "AUDIENCE").length;
  const localPublishers = members.filter((member) =>
    ["HOST", "PARTY_OWNER", "AUDIO_GUEST", "RTC_SPEAKER"].includes(member.media_role) && Boolean(member.media_publishing),
  );
  const [pkPublishers] = room.room_type !== "PARTY" && pkCompositeEnabled
    ? await db().query<(RowDataPacket & {
        public_id: number;
        room_role: string;
        media_role: string;
        muted: number;
        media_publishing: number;
        publisher_room_code: string;
      })[]>(
        `SELECT user.public_id, member.room_role, member.media_role, member.muted,
                other_room.room_code publisher_room_code,
                CASE WHEN member.media_role = 'HOST' THEN
                  (COALESCE(accounting.media_publishing, FALSE)
                    AND accounting.last_media_heartbeat_at >= CURRENT_TIMESTAMP(3) - INTERVAL 30 SECOND)
                  ELSE (member.media_publishing
                    AND member.last_media_heartbeat_at >= CURRENT_TIMESTAMP(3) - INTERVAL 30 SECOND)
                END media_publishing
         FROM live_pk_sessions pk
         INNER JOIN live_rooms other_room
           ON other_room.id = CASE WHEN pk.source_room_id = ? THEN pk.target_room_id ELSE pk.source_room_id END
         INNER JOIN live_room_members member ON member.room_id = other_room.id AND member.left_at IS NULL
         INNER JOIN application_users user ON user.id = member.application_user_id
         LEFT JOIN live_session_accounting accounting ON accounting.room_id = other_room.id AND accounting.status = 'ACTIVE'
         WHERE pk.status = 'ACTIVE' AND (pk.source_room_id = ? OR pk.target_room_id = ?)
           AND other_room.status IN ('ACTIVE','LOCKED')
           AND member.last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 2 MINUTE
           AND member.media_role IN ('HOST','AUDIO_GUEST')
         ORDER BY member.media_role = 'HOST' DESC, member.joined_at`,
        [room.id, room.id, room.id],
      )
    : [[]];
  const allPublishers = [...localPublishers, ...pkPublishers.filter((member) => Boolean(member.media_publishing))];
  const orderedPublishers = [
    ...allPublishers.filter((member) => ["HOST", "PARTY_OWNER"].includes(member.media_role)),
    ...allPublishers.filter((member) => !["HOST", "PARTY_OWNER"].includes(member.media_role)),
  ].filter((member, index, all) =>
    all.findIndex((candidate) => candidate.public_id === member.public_id && candidate.publisher_room_code === member.publisher_room_code) === index,
  ).slice(0, 9);
  const hasHost = localPublishers.some((member) => ["HOST", "PARTY_OWNER"].includes(member.media_role));
  const shouldRun = room.status !== "ENDED" && featureEnabled && playbackRequested && hasHost && audienceCount > 0 &&
    (room.room_type !== "PARTY" || audienceCount >= threshold);
  const hostCount = orderedPublishers.filter((member) => ["HOST", "PARTY_OWNER"].includes(member.media_role)).length;
  let hostIndex = 0;
  const inputs: MixInput[] = orderedPublishers.map((member) => {
    const hostVideo = room.room_type !== "PARTY" && member.media_role === "HOST";
    const currentHostIndex = hostVideo ? hostIndex++ : -1;
    const left = hostCount > 1 ? currentHostIndex * 360 : 0;
    const right = hostCount > 1 ? Math.min(720, left + 360) : 720;
    return {
      StreamId: `${member.publisher_room_code}_${member.public_id}_main`,
      ContentControl: hostVideo ? 0 : 1,
      ...(hostVideo ? { RectInfo: { Top: 0, Left: left, Bottom: 1280, Right: right, Layer: currentHostIndex } } : {}),
    };
  });
  const desiredHash = createHash("sha256").update(JSON.stringify({ shouldRun, inputs })).digest("hex");
  return withTransaction(async (connection: PoolConnection) => {
    const compactId = room.id.replaceAll("-", "");
    await connection.execute(
      `INSERT IGNORE INTO live_media_mix_tasks
        (room_id, task_id, output_stream_id, status)
       VALUES (?, ?, ?, 'INACTIVE')`,
      [room.id, `nazraa_mix_${compactId}`, `nazraa_${compactId}`],
    );
    const [states] = await connection.query<(RowDataPacket & {
      task_id: string;
      output_stream_id: string;
      desired_hash: string | null;
      applied_hash: string | null;
      sequence_number: number;
      status: string;
      updated_at: Date;
    })[]>("SELECT * FROM live_media_mix_tasks WHERE room_id = ? LIMIT 1 FOR UPDATE", [room.id]);
    const state = states[0];
    if (!state) return null;
    const syncingRecently = state.status === "SYNCING" && Date.now() - new Date(state.updated_at).getTime() < 15_000;
    if (syncingRecently || (state.applied_hash === desiredHash && state.status === (shouldRun ? "ACTIVE" : "INACTIVE"))) return null;
    const sequence = Number(state.sequence_number) + 1;
    const shouldStop = !shouldRun && ["ACTIVE", "ERROR", "SYNCING"].includes(state.status);
    if (!shouldRun && !shouldStop) {
      await connection.execute(
        "UPDATE live_media_mix_tasks SET desired_hash = ?, applied_hash = ?, status = 'INACTIVE', last_error = NULL WHERE room_id = ?",
        [desiredHash, desiredHash, room.id],
      );
      return null;
    }
    await connection.execute(
      "UPDATE live_media_mix_tasks SET desired_hash = ?, sequence_number = ?, status = 'SYNCING', last_error = NULL WHERE room_id = ?",
      [desiredHash, sequence, room.id],
    );
    return {
      roomId: room.id,
      roomCode: room.room_code,
      roomType: room.room_type,
      taskId: state.task_id,
      outputStreamId: state.output_stream_id,
      sequence,
      desiredHash,
      inputs,
      shouldRun,
      shouldStop,
    } satisfies MixerPlan;
  });
}

/** Best-effort sync: media-control outages must never fail chat, presence or room exit. */
export async function syncZegoRoomMixer(roomCode: string) {
  const api = new ZegoStreamMixingApi();
  if (!api.isConfigured) return { status: "disabled" as const };
  const plan = await preparePlan(roomCode);
  if (!plan) return { status: "unchanged" as const };
  try {
    const result = plan.shouldRun ? await api.start(plan) : await api.stop(plan);
    const playInfo = result.Data?.PlayInfo?.[0];
    const playbackUrl = playInfo?.HLS ?? playInfo?.FLV ?? null;
    await db().execute(
      plan.shouldRun
        ? `UPDATE live_media_mix_tasks
           SET applied_hash = ?, status = 'ACTIVE', playback_url = COALESCE(?, playback_url),
               last_error = NULL, last_synced_at = CURRENT_TIMESTAMP(3),
               active_started_at = COALESCE(active_started_at, CURRENT_TIMESTAMP(3)), stopped_at = NULL
           WHERE room_id = ? AND sequence_number = ?`
        : `UPDATE live_media_mix_tasks
           SET applied_hash = ?, status = 'INACTIVE', playback_url = COALESCE(?, playback_url),
               last_error = NULL, last_synced_at = CURRENT_TIMESTAMP(3),
               active_duration_seconds = active_duration_seconds + IF(active_started_at IS NULL, 0,
                 GREATEST(0, TIMESTAMPDIFF(SECOND, active_started_at, CURRENT_TIMESTAMP(3)))),
               active_started_at = NULL, stopped_at = CURRENT_TIMESTAMP(3)
           WHERE room_id = ? AND sequence_number = ?`,
      [plan.desiredHash, playbackUrl, plan.roomId, plan.sequence],
    );
    return { status: plan.shouldRun ? "active" as const : "stopped" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "ZEGO mixer request failed.";
    await db().execute(
      `UPDATE live_media_mix_tasks SET status = 'ERROR', last_error = ?, last_synced_at = CURRENT_TIMESTAMP(3)
       WHERE room_id = ? AND sequence_number = ?`,
      [message, plan.roomId, plan.sequence],
    );
    return { status: "error" as const };
  }
}
