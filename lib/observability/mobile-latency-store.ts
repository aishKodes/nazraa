import "server-only";

import { db } from "@/lib/db/pool";
import type { MobileLatencyTrace } from "./mobile-latency-context";
import { mobileLatencySnapshot } from "./mobile-latency-context";

const bounds = [25, 50, 100, 200, 350, 500, 750, 1000, 1500, 2500, 5000, 10000, 30000];

/**
 * These aggregates are diagnostic samples, not financial or room state.
 * Persisting two SQL upserts after every five-second presence poll created
 * more than 200,000 avoidable writes in a six-hour production window and
 * competed with the single DB connection in each Vercel isolate. A 5% hot
 * sample still gives thousands of observations for the common room path.
 */
export function shouldPersistMobileLatency(
  operation: string,
  sample = Math.random(),
) {
  const rate = operation === "POST:room-presence" || operation === "POST:pk-battle"
    ? 0.05
    : 0.10;
  return Number.isFinite(sample) && sample >= 0 && sample < rate;
}

function bucketFor(milliseconds: number) {
  return bounds.find((bound) => milliseconds <= bound) ?? bounds.at(-1)!;
}

/// Runs after the HTTP response. It stores aggregate buckets only: no user
/// ID, request body, token, SQL text, or message content is retained.
export async function persistMobileLatency(trace: MobileLatencyTrace) {
  const snapshot = mobileLatencySnapshot(trace);
  const stages = [
    ["total", snapshot.totalMs],
    ["db_acquire", snapshot.dbAcquireMs],
    ["db_transaction", snapshot.dbTransactionMs],
    ["db_query", snapshot.dbQueryMs],
    ["backend", snapshot.backendMs],
  ] as const;
  const counters = stages.map(([stage, milliseconds]) => [
    snapshot.operation,
    stage,
    milliseconds,
  ]);
  const buckets = stages.map(([stage, milliseconds]) => [
    snapshot.operation,
    stage,
    bucketFor(milliseconds),
  ]);
  try {
    await db().query(
      `INSERT INTO mobile_latency_counters
         (metric_date, operation_key, stage, sample_count, total_ms, max_ms)
       VALUES ${counters.map(() => "(UTC_DATE(), ?, ?, 1, ?, ?)").join(", ")}
       ON DUPLICATE KEY UPDATE
         sample_count = sample_count + 1,
         total_ms = total_ms + VALUES(total_ms),
         max_ms = GREATEST(max_ms, VALUES(max_ms))`,
      counters.flatMap(([operation, stage, milliseconds]) => [operation, stage, milliseconds, milliseconds]),
    );
    await db().query(
      `INSERT INTO mobile_latency_buckets
         (metric_date, operation_key, stage, upper_bound_ms, sample_count)
       VALUES ${buckets.map(() => "(UTC_DATE(), ?, ?, ?, 1)").join(", ")}
       ON DUPLICATE KEY UPDATE sample_count = sample_count + 1`,
      buckets.flat(),
    );
  } catch {
    // Observability is strictly non-critical. It never turns a successful
    // room, Gift, or financial action into a visible failure.
  }
}

/**
 * Stores sampled client room-join timing as aggregate buckets only.  No room,
 * participant, device identifier, media URL, token, or message data is ever
 * persisted.  This intentionally reuses the existing observability tables so
 * it adds no migration or durable per-user telemetry.
 */
export async function persistRoomJoinLatency(input: {
  provider: "livekit" | "zego" | "unknown";
  outcome: "success" | "failed";
  shellMs?: number;
  roomJoinMs?: number;
  mediaBootstrapMs?: number;
  connectedMs?: number;
  firstAudioMs?: number;
  firstVideoMs?: number;
}) {
  const operation = `room_join_${input.provider}_${input.outcome}`;
  const stages = Object.entries({
    tap_to_shell: input.shellMs,
    tap_to_room_join: input.roomJoinMs,
    tap_to_media_bootstrap: input.mediaBootstrapMs,
    tap_to_connected: input.connectedMs,
    tap_to_first_audio: input.firstAudioMs,
    tap_to_first_video: input.firstVideoMs,
  }).flatMap(([stage, value]) => {
    const milliseconds = Number(value);
    return Number.isFinite(milliseconds) && milliseconds >= 0 && milliseconds <= 120_000
      ? [[stage, Math.round(milliseconds)] as const]
      : [];
  });
  if (stages.length === 0) return;
  const counters = stages.map(([stage, milliseconds]) => [operation, stage, milliseconds]);
  const buckets = stages.map(([stage, milliseconds]) => [operation, stage, bucketFor(milliseconds)]);
  try {
    await db().query(
      `INSERT INTO mobile_latency_counters
         (metric_date, operation_key, stage, sample_count, total_ms, max_ms)
       VALUES ${counters.map(() => "(UTC_DATE(), ?, ?, 1, ?, ?)").join(", ")}
       ON DUPLICATE KEY UPDATE
         sample_count = sample_count + 1,
         total_ms = total_ms + VALUES(total_ms),
         max_ms = GREATEST(max_ms, VALUES(max_ms))`,
      counters.flatMap(([metric, stage, milliseconds]) => [metric, stage, milliseconds, milliseconds]),
    );
    await db().query(
      `INSERT INTO mobile_latency_buckets
         (metric_date, operation_key, stage, upper_bound_ms, sample_count)
       VALUES ${buckets.map(() => "(UTC_DATE(), ?, ?, ?, 1)").join(", ")}
       ON DUPLICATE KEY UPDATE sample_count = sample_count + 1`,
      buckets.flat(),
    );
  } catch {
    // A metrics write can never interfere with room entry.
  }
}
