import "server-only";

import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import type { Scope } from "@/types/platform";

const minimumDays = 1;
const maximumDays = 3650;

function boundedDays(value: number) {
  if (!Number.isInteger(value) || value < minimumDays || value > maximumDays) {
    throw new Error(`Choose a diagnostic period from ${minimumDays} to ${maximumDays} days.`);
  }
  return value;
}

type CountRow = RowDataPacket & { count: number };

/**
 * Aggregate-only production audit. It intentionally starts with the durable
 * reward decision rather than trying to infer entitlement eligibility from
 * old client timers. Rows without a decision remain explicit candidates for
 * review, not invented rewards.
 */
export async function getLiveRewardDiagnostics(days = 30) {
  const bounded = boundedDays(days);
  const [sessionRows] = await db().query<(RowDataPacket & {
    sessions: number;
    confirmed: number;
    reconciled: number;
    estimated: number;
    active: number;
    eligible_seconds: number;
    candidate_sessions_without_decision: number;
  })[]>(
    `SELECT COUNT(*) sessions,
            SUM(accounting.accounting_accuracy = 'CONFIRMED') confirmed,
            SUM(accounting.accounting_accuracy = 'RECONCILED') reconciled,
            SUM(accounting.accounting_accuracy = 'ESTIMATED') estimated,
            SUM(accounting.status = 'ACTIVE') active,
            COALESCE(SUM(accounting.eligible_seconds_committed), 0) eligible_seconds,
            SUM(
              accounting.accounting_accuracy = 'CONFIRMED'
              AND accounting.room_type IN ('FACE', 'LIVE')
              AND accounting.eligible_seconds_committed >= 3600
              AND NOT EXISTS (
                SELECT 1 FROM live_hour_reward_decisions decision_row
                WHERE decision_row.live_session_accounting_id = accounting.id
              )
            ) candidate_sessions_without_decision
     FROM live_session_accounting accounting
     WHERE accounting.started_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? DAY)`,
    [bounded],
  );
  const [rewardRows] = await db().query<(RowDataPacket & {
    expected_units: number;
    generated_units: number;
    missing_units: number;
    repairable_missing_units: number;
    uncertain_missing_units: number;
    duplicate_units: number;
    claimed_units: number;
    unclaimed_units: number;
  })[]>(
    `SELECT
       COUNT(*) expected_units,
       SUM(entitlement.id IS NOT NULL) generated_units,
       SUM(entitlement.id IS NULL) missing_units,
       SUM(entitlement.id IS NULL AND accounting.accounting_accuracy = 'CONFIRMED') repairable_missing_units,
       SUM(entitlement.id IS NULL AND accounting.accounting_accuracy <> 'CONFIRMED') uncertain_missing_units,
       SUM(entitlement.claim_status = 'CLAIMED') claimed_units,
       SUM(entitlement.claim_status = 'UNCLAIMED') unclaimed_units,
       0 duplicate_units
     FROM live_hour_reward_decisions decision_row
     INNER JOIN live_session_accounting accounting
       ON accounting.id = decision_row.live_session_accounting_id
     LEFT JOIN live_reward_entitlements entitlement
       ON entitlement.live_hour_reward_decision_id = decision_row.id
     WHERE decision_row.eligible = TRUE
       AND decision_row.reward_diamonds > 0
       AND decision_row.decided_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? DAY)`,
    [bounded],
  );
  const [duplicateRows] = await db().query<CountRow[]>(
    `SELECT COUNT(*) count FROM (
       SELECT live_hour_reward_decision_id
       FROM live_reward_entitlements
       WHERE created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? DAY)
       GROUP BY live_hour_reward_decision_id
       HAVING COUNT(*) > 1
     ) duplicate_decisions`,
    [bounded],
  );
  const [qaRows] = await db().query<(RowDataPacket & { runs: number })[]>(
    `SELECT COUNT(*) runs
     FROM live_reward_qa_runs
     WHERE completed_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? DAY)`,
    [bounded],
  );
  const session = sessionRows[0];
  const reward = rewardRows[0];
  return {
    periodDays: bounded,
    sessions: Number(session?.sessions ?? 0),
    accuracy: {
      confirmed: Number(session?.confirmed ?? 0),
      reconciled: Number(session?.reconciled ?? 0),
      estimated: Number(session?.estimated ?? 0),
    },
    activeSessions: Number(session?.active ?? 0),
    eligibleSecondsCommitted: Number(session?.eligible_seconds ?? 0),
    expectedRewardUnits: Number(reward?.expected_units ?? 0),
    generatedRewardUnits: Number(reward?.generated_units ?? 0),
    missingRewardUnits: Number(reward?.missing_units ?? 0),
    repairableMissingRewardUnits: Number(reward?.repairable_missing_units ?? 0),
    uncertainMissingRewardUnits: Number(reward?.uncertain_missing_units ?? 0),
    duplicateRewardUnits: Number(duplicateRows[0]?.count ?? reward?.duplicate_units ?? 0),
    claimedRewardUnits: Number(reward?.claimed_units ?? 0),
    unclaimedRewardUnits: Number(reward?.unclaimed_units ?? 0),
    inconsistentSessionCandidates: Number(session?.candidate_sessions_without_decision ?? 0),
    qaNonFinancialRuns: Number(qaRows[0]?.runs ?? 0),
  };
}

/** Repairs only a missing entitlement for an already immutable eligible reward
 * decision. It never decides eligibility, changes a reward amount, or credits
 * a wallet. The unique decision key makes repeat execution idempotent. */
export async function repairMissingLiveRewardEntitlements(input: {
  scope: Scope;
  days: number;
  reason: string;
}) {
  if (input.scope.account.role !== "MASTER") {
    throw new Error("Only Master can repair an already-decided Live reward entitlement.");
  }
  const bounded = boundedDays(input.days);
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 500) {
    throw new Error("Provide an audit reason of 5 to 500 characters.");
  }
  return withTransaction(async (connection) => {
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT IGNORE INTO live_reward_entitlements
        (id, live_hour_reward_decision_id, live_session_accounting_id,
         application_user_id, agency_account_id, completed_hour, amount,
         claim_status, earned_at, claimed_at, ledger_transaction_id)
       SELECT UUID(), decision_row.id, decision_row.live_session_accounting_id,
              decision_row.host_application_user_id, room.agency_account_id,
              decision_row.completed_hour, decision_row.reward_diamonds,
              IF(decision_row.ledger_transaction_id IS NULL, 'UNCLAIMED', 'CLAIMED'),
              decision_row.decided_at,
              IF(decision_row.ledger_transaction_id IS NULL, NULL, decision_row.decided_at),
              decision_row.ledger_transaction_id
       FROM live_hour_reward_decisions decision_row
       INNER JOIN live_session_accounting accounting
         ON accounting.id = decision_row.live_session_accounting_id
       INNER JOIN live_rooms room ON room.id = accounting.room_id
       LEFT JOIN live_reward_entitlements entitlement
         ON entitlement.live_hour_reward_decision_id = decision_row.id
       WHERE decision_row.eligible = TRUE
         AND decision_row.reward_diamonds > 0
         AND entitlement.id IS NULL
         AND accounting.accounting_accuracy = 'CONFIRMED'
         AND decision_row.decided_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? DAY)`,
      [bounded],
    );
    await connection.execute(
      `UPDATE live_session_accounting accounting
       SET reward_units_generated = (
         SELECT COUNT(*) FROM live_reward_entitlements entitlement
         WHERE entitlement.live_session_accounting_id = accounting.id
       )
       WHERE accounting.started_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? DAY)`,
      [bounded],
    );
    await connection.execute(
      `INSERT INTO audit_logs
        (id, actor_account_id, actor_role, action, module, target_type,
         target_id, new_data, reason)
       VALUES (?, ?, ?, 'live_rewards.repair_missing_entitlements',
               'live_accounting', 'aggregate_period', ?, ?, ?)`,
      [
        randomUUID(),
        input.scope.account.id,
        input.scope.account.role,
        `${bounded}d`,
        JSON.stringify({ insertedEntitlements: result.affectedRows, periodDays: bounded }),
        reason,
      ],
    );
    return { insertedEntitlements: result.affectedRows, periodDays: bounded };
  });
}

export async function configureLiveRewardQaOverride(input: {
  scope: Scope;
  applicationUserId: string;
  thresholdSeconds: number;
  expiresInMinutes: number;
  enabled: boolean;
  reason: string;
}) {
  if (input.scope.account.role !== "MASTER") {
    throw new Error("Only Master can manage the isolated Live-reward QA override.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(input.applicationUserId)) {
    throw new Error("Choose a valid dedicated QA Host account.");
  }
  if (!Number.isInteger(input.thresholdSeconds) || input.thresholdSeconds < 60 || input.thresholdSeconds > 180) {
    throw new Error("QA threshold must be from 60 to 180 seconds.");
  }
  if (!Number.isInteger(input.expiresInMinutes) || input.expiresInMinutes < 1 || input.expiresInMinutes > 120) {
    throw new Error("QA expiry must be from 1 to 120 minutes.");
  }
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 500) {
    throw new Error("Provide an audit reason of 5 to 500 characters.");
  }
  await withTransaction(async (connection) => {
    const [reviewers] = await connection.query<CountRow[]>(
      `SELECT COUNT(*) count
       FROM play_reviewer_credentials
       WHERE application_user_id = ? AND reviewer_role = 'HOST' AND active = TRUE
       LIMIT 1 FOR UPDATE`,
      [input.applicationUserId],
    );
    if (!Number(reviewers[0]?.count ?? 0)) {
      throw new Error("The QA override is restricted to an active dedicated reviewer Host.");
    }
    await connection.execute(
      `INSERT INTO mobile_access_overrides
        (application_user_id, host_access_override, play_reviewer_access_override,
         live_reward_qa_enabled, live_reward_qa_threshold_seconds,
         live_reward_qa_expires_at, note)
       VALUES (?, FALSE, FALSE, ?, ?,
               IF(?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MINUTE), NULL),
               'Master-controlled non-financial Live reward QA')
       ON DUPLICATE KEY UPDATE
         live_reward_qa_enabled = VALUES(live_reward_qa_enabled),
         live_reward_qa_threshold_seconds = VALUES(live_reward_qa_threshold_seconds),
         live_reward_qa_expires_at = VALUES(live_reward_qa_expires_at),
         note = VALUES(note)`,
      [
        input.applicationUserId,
        input.enabled,
        input.thresholdSeconds,
        input.enabled,
        input.expiresInMinutes,
      ],
    );
    await connection.execute(
      `INSERT INTO audit_logs
        (id, actor_account_id, actor_role, action, module, target_type,
         target_id, new_data, reason)
       VALUES (?, ?, ?, 'live_rewards.qa_override', 'live_accounting',
               'application_user', ?, ?, ?)`,
      [
        randomUUID(), input.scope.account.id, input.scope.account.role,
        input.applicationUserId,
        JSON.stringify({ enabled: input.enabled, thresholdSeconds: input.thresholdSeconds, expiresInMinutes: input.expiresInMinutes, nonFinancial: true }),
        reason,
      ],
    );
  });
}
