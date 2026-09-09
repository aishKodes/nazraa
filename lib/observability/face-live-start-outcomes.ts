import "server-only";

import type { RowDataPacket } from "mysql2";
import { db } from "@/lib/db/pool";

export type FaceLiveStartOutcome = "SUCCESS" | "FAILURE";
export type FaceLiveStartFailureCategory =
  | "VERIFICATION"
  | "ELIGIBILITY"
  | "POLICY"
  | "SCHEDULE"
  | "DATABASE"
  | "INVALID_REQUEST"
  | "UNKNOWN";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Maps known server-side denial classes to a small fixed taxonomy.  Never
 * retain the original exception because it can include internal provider
 * detail and is not required for an aggregate reliability signal.
 */
export function classifyFaceLiveStartFailure(
  error: unknown,
): FaceLiveStartFailureCategory {
  const code = isRecord(error) && "code" in error ? String(error.code ?? "") : "";
  const message = error instanceof Error ? error.message : "";
  if (
    code.startsWith("ER_") ||
    /database|mysql|connection|timeout|econn|protocol/i.test(message)
  ) {
    return "DATABASE";
  }
  if (/face verification|verified face/i.test(message)) return "VERIFICATION";
  if (/policy|terms|guidelines|acceptance/i.test(message)) return "POLICY";
  if (/available from|live streaming is available|time window/i.test(message)) {
    return "SCHEDULE";
  }
  if (/invalid|require|room code|title|category|language/i.test(message)) {
    return "INVALID_REQUEST";
  }
  if (/role|host|hosting|restricted|suspend|account cannot/i.test(message)) {
    return "ELIGIBILITY";
  }
  return "UNKNOWN";
}

/** Best-effort aggregate telemetry.  Never affects room creation or retries. */
export async function recordFaceLiveStartOutcome(
  outcome: FaceLiveStartOutcome,
  category: FaceLiveStartFailureCategory = "UNKNOWN",
) {
  try {
    await db().execute(
      `INSERT INTO mobile_face_start_outcomes
        (metric_date, outcome, category, attempt_count)
       VALUES (UTC_DATE(), ?, ?, 1)
       ON DUPLICATE KEY UPDATE attempt_count = attempt_count + 1`,
      [outcome, outcome === "SUCCESS" ? "NONE" : category],
    );
  } catch {
    // Observability must never turn a successful Live start into a failure.
  }
}

export async function getFaceLiveStartOutcomeDiagnostics(days = 30) {
  const boundedDays = Number.isInteger(days)
    ? Math.min(365, Math.max(1, days))
    : 30;
  const [rows] = await db().query<
    (RowDataPacket & {
      outcome: FaceLiveStartOutcome;
      category: string;
      attempts: number;
    })[]
  >(
    `SELECT outcome, category, SUM(attempt_count) attempts
     FROM mobile_face_start_outcomes
     WHERE metric_date >= UTC_DATE() - INTERVAL ? DAY
     GROUP BY outcome, category
     ORDER BY outcome, attempts DESC`,
    [boundedDays],
  );
  const attempts = rows.reduce((total, row) => total + Number(row.attempts), 0);
  const successes = rows
    .filter((row) => row.outcome === "SUCCESS")
    .reduce((total, row) => total + Number(row.attempts), 0);
  return {
    periodDays: boundedDays,
    attempts,
    successes,
    failures: Math.max(0, attempts - successes),
    successRate: attempts === 0 ? null : successes / attempts,
    failuresByCategory: rows
      .filter((row) => row.outcome === "FAILURE")
      .map((row) => ({ category: row.category, attempts: Number(row.attempts) })),
  };
}
