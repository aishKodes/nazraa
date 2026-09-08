import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import mysql from "mysql2/promise";

const required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD", "NAZRAA_BENCHMARK_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing required configuration: ${missing.join(", ")}`);
if (process.env.NAZRAA_BENCHMARK_ENABLED !== "true") {
  throw new Error("Set NAZRAA_BENCHMARK_ENABLED=true to start this isolated canary.");
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  charset: "utf8mb4_general_ci",
  waitForConnections: true,
  connectionLimit: Math.min(8, Math.max(1, Number(process.env.DB_CONNECTION_LIMIT ?? 4))),
  maxIdle: 2,
  idleTimeout: 30_000,
  queueLimit: 48,
  connectTimeout: 12_000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  decimalNumbers: true,
  timezone: "Z",
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});

const operations = new Set([
  "profile",
  "room-block",
  "room-bootstrap",
  "game-bet-validation",
  "discover",
  "gift-preparation",
  "verification-finalization",
]);

function milliseconds(startedAt) {
  return Number((performance.now() - startedAt).toFixed(1));
}

function authorized(request) {
  const actual = Buffer.from(request.headers["x-nazraa-benchmark-key"] ?? "");
  const expected = Buffer.from(process.env.NAZRAA_BENCHMARK_KEY);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function withProbe(operation) {
  const totalStartedAt = performance.now();
  const acquiredAt = performance.now();
  const connection = await pool.getConnection();
  const dbAcquireMs = milliseconds(acquiredAt);
  let dbQueryMs = 0;
  let queryCount = 0;
  const query = async (sql, values = []) => {
    const startedAt = performance.now();
    try {
      return await connection.query(sql, values);
    } finally {
      dbQueryMs += milliseconds(startedAt);
      queryCount += 1;
    }
  };

  try {
    // This probe does not return personal data, financial balances, room IDs,
    // or media URLs. It uses current production query shapes only to measure
    // the Node-to-MySQL path without changing application state.
    const [[user]] = await query(
      "SELECT id FROM application_users WHERE account_status = 'ACTIVE' ORDER BY updated_at DESC LIMIT 1",
    );
    const userId = user?.id ?? "00000000-0000-0000-0000-000000000000";

    if (operation === "profile") {
      await Promise.all([
        query("SELECT public_id, level_number, anchor_level_number, vip_tier, is_host FROM application_users WHERE id = ? LIMIT 1", [userId]),
        query("SELECT asset_type, available_balance, reserved_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ?", [userId]),
      ]);
    } else if (operation === "room-block") {
      const [[room]] = await query("SELECT id FROM live_rooms WHERE status IN ('ACTIVE', 'LOCKED') ORDER BY started_at DESC LIMIT 1");
      await query("SELECT 1 FROM live_room_blocks WHERE room_id = ? AND application_user_id = ? AND active = TRUE LIMIT 1", [room?.id ?? "00000000-0000-0000-0000-000000000000", userId]);
    } else if (operation === "room-bootstrap") {
      const [[room]] = await query("SELECT id, host_application_user_id, room_type, status FROM live_rooms WHERE status IN ('ACTIVE', 'LOCKED') ORDER BY started_at DESC LIMIT 1");
      const roomId = room?.id ?? "00000000-0000-0000-0000-000000000000";
      await Promise.all([
        query("SELECT room_role, media_role, muted, seat_index FROM live_room_members WHERE room_id = ? AND application_user_id = ? LIMIT 1", [roomId, userId]),
        query("SELECT 1 FROM live_room_blocks WHERE room_id = ? AND application_user_id = ? AND active = TRUE LIMIT 1", [roomId, userId]),
        query("SELECT COUNT(*) audience_count FROM live_room_members WHERE room_id = ? AND left_at IS NULL", [roomId]),
      ]);
    } else if (operation === "game-bet-validation") {
      const [[round]] = await query("SELECT id FROM game_shared_rounds WHERE game_name = 'luck77' ORDER BY betting_starts_at DESC LIMIT 1");
      await Promise.all([
        query("SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.games' LIMIT 1"),
        query("SELECT id, available_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' LIMIT 1", [userId]),
        query("SELECT COALESCE(SUM(wager_total), 0) total FROM game_shared_bet_requests WHERE round_id = ? AND application_user_id = ?", [round?.id ?? "00000000-0000-0000-0000-000000000000", userId]),
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
    } else {
      throw new Error("Unsupported benchmark operation.");
    }

    return {
      operation,
      totalMs: milliseconds(totalStartedAt),
      dbAcquireMs,
      dbQueryAggregateMs: Number(dbQueryMs.toFixed(1)),
      queryCount,
      mutationFree: true,
    };
  } finally {
    connection.release();
  }
}

function send(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    return send(response, 200, { status: "ok", service: "nazraa-hostinger-performance-canary" });
  }
  if (request.method !== "POST" || request.url !== "/benchmark" || !authorized(request)) {
    return send(response, 404, { message: "Not found." });
  }

  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", async () => {
    try {
      const parsed = JSON.parse(body || "{}");
      const operation = String(parsed.operation ?? "");
      if (!operations.has(operation)) return send(response, 400, { message: "Invalid operation." });
      return send(response, 200, await withProbe(operation));
    } catch (error) {
      // Keep details out of a publicly reachable endpoint; the application
      // dashboard/host logs retain the provider-side diagnostic.
      // The code is enough to diagnose provider connectivity/auth issues without
      // ever logging SQL, request values, database credentials, or user data.
      console.error("canary probe failed", error && typeof error === "object" && "code" in error
        ? String(error.code)
        : error instanceof Error ? error.name : "unknown");
      return send(response, 503, { message: "Benchmark service is temporarily unavailable." });
    }
  });
});

server.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
