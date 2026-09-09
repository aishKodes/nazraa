import "server-only";

import { db } from "@/lib/db/pool";
import type { MobileLatencyTrace } from "./mobile-latency-context";
import { mobileLatencySnapshot } from "./mobile-latency-context";

const bounds = [25, 50, 100, 200, 350, 500, 750, 1000, 1500, 2500, 5000, 10000, 30000];

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
