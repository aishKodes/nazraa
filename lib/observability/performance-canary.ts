import "server-only";

import { getDatabaseConnection, withDatabaseReadRetry } from "@/lib/db/pool";

export const performanceCanaryOperations = [
  "profile",
  "room-block",
  "room-bootstrap",
  "game-bet-validation",
  "discover",
  "gift-preparation",
  "verification-finalization",
] as const;

export type PerformanceCanaryOperation = typeof performanceCanaryOperations[number];

const probeUserId = "00000000-0000-0000-0000-000000000000";

function elapsed(startedAt: number) {
  return Number((performance.now() - startedAt).toFixed(1));
}

/**
 * Executes only read queries matching latency-sensitive production query
 * shapes. It intentionally returns timings/counts only—never user, room,
 * wallet, media, verification, or financial data—and never runs a mutation.
 */
export async function runPerformanceCanary(operation: PerformanceCanaryOperation) {
  return withDatabaseReadRetry(async () => {
    const totalStartedAt = performance.now();
    const acquiredAt = performance.now();
    const connection = await getDatabaseConnection();
    const dbAcquireMs = elapsed(acquiredAt);
    let dbQueryAggregateMs = 0;
    let queryCount = 0;

    const query = async (sql: string, values: unknown[] = []) => {
      const queryStartedAt = performance.now();
      try {
        return await connection.query(sql, values);
      } finally {
        dbQueryAggregateMs += elapsed(queryStartedAt);
        queryCount += 1;
      }
    };

    try {
      const [userRows] = await query(
        "SELECT id FROM application_users WHERE account_status = 'ACTIVE' ORDER BY updated_at DESC LIMIT 1",
      );
      const user = (userRows as Array<{ id: string }>)[0];
      const userId = user?.id ?? probeUserId;

      if (operation === "profile") {
        await Promise.all([
          query("SELECT public_id, level_number, anchor_level_number, vip_tier, is_host FROM application_users WHERE id = ? LIMIT 1", [userId]),
          query("SELECT asset_type, available_balance, reserved_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ?", [userId]),
        ]);
      } else if (operation === "room-block") {
        const [roomRows] = await query(
          "SELECT id FROM live_rooms WHERE status IN ('ACTIVE', 'LOCKED') ORDER BY started_at DESC LIMIT 1",
        );
        const room = (roomRows as Array<{ id: string }>)[0];
        await query(
          "SELECT 1 FROM live_room_blocks WHERE room_id = ? AND application_user_id = ? AND active = TRUE LIMIT 1",
          [room?.id ?? probeUserId, userId],
        );
      } else if (operation === "room-bootstrap") {
        const [roomRows] = await query(
          "SELECT id FROM live_rooms WHERE status IN ('ACTIVE', 'LOCKED') ORDER BY started_at DESC LIMIT 1",
        );
        const room = (roomRows as Array<{ id: string }>)[0];
        const roomId = room?.id ?? probeUserId;
        await Promise.all([
          query("SELECT room_role, media_role, muted, seat_index FROM live_room_members WHERE room_id = ? AND application_user_id = ? LIMIT 1", [roomId, userId]),
          query("SELECT 1 FROM live_room_blocks WHERE room_id = ? AND application_user_id = ? AND active = TRUE LIMIT 1", [roomId, userId]),
          query("SELECT COUNT(*) audience_count FROM live_room_members WHERE room_id = ? AND left_at IS NULL", [roomId]),
        ]);
      } else if (operation === "game-bet-validation") {
        const [roundRows] = await query(
          "SELECT id FROM game_shared_rounds WHERE game_name = 'luck77' ORDER BY betting_starts_at DESC LIMIT 1",
        );
        const round = (roundRows as Array<{ id: string }>)[0];
        await Promise.all([
          query("SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.games' LIMIT 1"),
          query("SELECT id, available_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' LIMIT 1", [userId]),
          query("SELECT COALESCE(SUM(wager_total), 0) total FROM game_shared_bet_requests WHERE round_id = ? AND application_user_id = ?", [round?.id ?? probeUserId, userId]),
        ]);
      } else if (operation === "discover") {
        await query(
          `SELECT post.id, post.asset_id, post.created_at, user.public_id, user.level_number, user.vip_tier
           FROM discovery_posts post
           INNER JOIN application_users user ON user.id = post.application_user_id
           WHERE post.status IN ('VISIBLE', 'UNDER_REVIEW')
           ORDER BY post.created_at DESC, post.id DESC LIMIT 30`,
        );
      } else if (operation === "gift-preparation") {
        await Promise.all([
          query("SELECT gift_key, coin_price, category, active FROM gift_catalog WHERE active = TRUE ORDER BY coin_price, name LIMIT 100"),
          query("SELECT id, public_id, vip_tier, account_status FROM application_users WHERE id = ? LIMIT 1", [userId]),
          query("SELECT id, available_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' LIMIT 1", [userId]),
        ]);
      } else if (operation === "verification-finalization") {
        await Promise.all([
          query("SELECT face_verification_status, agency_face_live_authorized FROM application_users WHERE id = ? LIMIT 1", [userId]),
          query("SELECT id, status, client_submission_id FROM face_verification_requests WHERE application_user_id = ? ORDER BY created_at DESC LIMIT 1", [userId]),
        ]);
      }

      return {
        operation,
        totalMs: elapsed(totalStartedAt),
        dbAcquireMs,
        dbQueryAggregateMs: Number(dbQueryAggregateMs.toFixed(1)),
        queryCount,
        mutationFree: true,
      };
    } finally {
      connection.release();
    }
  });
}

export function isPerformanceCanaryOperation(value: string): value is PerformanceCanaryOperation {
  return (performanceCanaryOperations as readonly string[]).includes(value);
}
