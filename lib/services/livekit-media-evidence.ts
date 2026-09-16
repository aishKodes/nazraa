import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { withTransaction } from "@/lib/db/transaction";

export type LiveKitWebhookEvent = {
  id?: unknown;
  event?: unknown;
  createdAt?: unknown;
  created_at?: unknown;
  room?: { name?: unknown };
  participant?: { identity?: unknown };
  track?: { sid?: unknown; type?: unknown; kind?: unknown; source?: unknown };
};

type NormalizedEvidence = {
  providerEventId: string;
  eventType: "track_published" | "track_unpublished" | "participant_left" | "participant_joined";
  roomCode: string;
  participantIdentity: string;
  trackSid: string | null;
  trackKind: "AUDIO" | "VIDEO" | null;
  occurredAt: Date;
  payloadSha256: string;
};

const supportedEvents = new Set([
  "track_published",
  "track_unpublished",
  "participant_left",
  "participant_joined",
]);

function stringValue(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function eventDate(value: unknown) {
  // LiveKit uses Unix seconds in EventWebhook; accept ISO only as a
  // compatibility fallback and never use a client-provided time.
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000);
  }
  if (typeof value === "bigint") {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000);
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function trackKind(track: LiveKitWebhookEvent["track"]): "AUDIO" | "VIDEO" | null {
  // The signed JSON webhook uses enum labels, whereas the SDK's decoded
  // protobuf may expose the TrackType numeric enum (AUDIO=0, VIDEO=1).
  if (track?.type === 0) return "AUDIO";
  if (track?.type === 1) return "VIDEO";
  const raw = [track?.type, track?.kind, track?.source]
    .map((value) => stringValue(value, 32).toUpperCase())
    .join(" ");
  if (raw.includes("VIDEO") || raw.includes("CAMERA")) return "VIDEO";
  if (raw.includes("AUDIO") || raw.includes("MICROPHONE")) return "AUDIO";
  return null;
}

export function normalizeLiveKitWebhookEvent(
  value: LiveKitWebhookEvent,
  rawPayload: string,
): NormalizedEvidence | null {
  const eventType = stringValue(value.event, 64).toLowerCase();
  const roomCode = stringValue(value.room?.name, 80);
  const participantIdentity = stringValue(value.participant?.identity, 128);
  if (
    !supportedEvents.has(eventType) ||
    !roomCode ||
    !participantIdentity
  ) return null;
  const suppliedId = stringValue(value.id, 128);
  // Older server versions omit id. The digest remains deterministic and is
  // constrained to this payload, so retries stay idempotent.
  const payloadSha256 = createHash("sha256").update(rawPayload).digest("hex");
  return {
    providerEventId: suppliedId || payloadSha256,
    eventType: eventType as NormalizedEvidence["eventType"],
    roomCode,
    participantIdentity,
    trackSid: stringValue(value.track?.sid, 128) || null,
    trackKind: trackKind(value.track),
    occurredAt: eventDate(value.createdAt ?? value.created_at),
    payloadSha256,
  };
}

/**
 * Applies provider-authenticated media evidence to the existing Live session
 * ledger. Client heartbeats remain the server-time accrual mechanism, while
 * this signal prevents a lost SDK callback from making a genuinely published
 * Live look offline. The procedure is deliberately non-financial.
 */
export async function recordLiveKitMediaEvidence(evidence: NormalizedEvidence) {
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & {
      room_id: string;
      room_type: "FACE" | "LIVE" | "PARTY";
      host_application_user_id: string;
      host_public_id: string;
      accounting_id: string | null;
    })[]>(
      `SELECT room.id room_id, room.room_type,
              room.host_application_user_id host_application_user_id,
              host.public_id host_public_id, accounting.id accounting_id
       FROM live_rooms room
       INNER JOIN application_users host ON host.id = room.host_application_user_id
       LEFT JOIN live_session_accounting accounting
         ON accounting.room_id = room.id AND accounting.status = 'ACTIVE'
       WHERE room.room_code = ? AND room.status IN ('ACTIVE','LOCKED')
       LIMIT 1 FOR UPDATE`,
      [evidence.roomCode],
    );
    const room = rows[0];
    if (!room || room.host_public_id !== evidence.participantIdentity) {
      return { applied: false, duplicate: false, reason: "not-host-or-inactive" };
    }

    const [insert] = await connection.execute(
      `INSERT IGNORE INTO livekit_media_events
        (id, provider_event_id, room_id, application_user_id, event_type,
         track_sid, track_kind, occurred_at, payload_sha256)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(), evidence.providerEventId, room.room_id,
        room.host_application_user_id, evidence.eventType,
        evidence.trackSid, evidence.trackKind, evidence.occurredAt,
        evidence.payloadSha256,
      ],
    );
    if ((insert as { affectedRows?: number }).affectedRows === 0) {
      return { applied: false, duplicate: true, reason: "duplicate" };
    }

    if (evidence.eventType === "participant_left") {
      await connection.execute(
        `UPDATE livekit_active_media_tracks
         SET active = FALSE, last_event_at = ?
         WHERE room_id = ? AND application_user_id = ? AND active = TRUE`,
        [evidence.occurredAt, room.room_id, room.host_application_user_id],
      );
    } else if (evidence.trackSid && evidence.trackKind) {
      await connection.execute(
        `INSERT INTO livekit_active_media_tracks
          (room_id, application_user_id, track_sid, track_kind, active, last_event_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           track_kind = VALUES(track_kind), active = VALUES(active),
           last_event_at = VALUES(last_event_at)`,
        [
          room.room_id, room.host_application_user_id, evidence.trackSid,
          evidence.trackKind, evidence.eventType === "track_published",
          evidence.occurredAt,
        ],
      );
    }

    if (room.accounting_id) {
      const wantedKind = room.room_type === "PARTY" ? "AUDIO" : "VIDEO";
      const [activeTracks] = await connection.query<(RowDataPacket & { count: number })[]>(
        `SELECT COUNT(*) count FROM livekit_active_media_tracks
         WHERE room_id = ? AND application_user_id = ?
           AND active = TRUE AND track_kind = ?`,
        [room.room_id, room.host_application_user_id, wantedKind],
      );
      const publishing = Number(activeTracks[0]?.count ?? 0) > 0;
      await connection.execute(
        `UPDATE live_session_accounting
         SET media_publishing = ?,
             last_media_evidence_at = CASE WHEN ? THEN CURRENT_TIMESTAMP(3) ELSE last_media_evidence_at END,
             reconnect_state = CASE WHEN ? THEN 'PUBLISHING' ELSE 'RECONNECTING' END,
             accounting_accuracy = 'CONFIRMED'
         WHERE id = ? AND status = 'ACTIVE'`,
        [publishing, publishing, publishing, room.accounting_id],
      );
    }
    return { applied: true, duplicate: false, reason: "recorded" };
  });
}
