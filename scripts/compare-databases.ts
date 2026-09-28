import "dotenv/config";
import { createHash } from "node:crypto";
import mysql, { type RowDataPacket } from "mysql2/promise";

type Side = "SOURCE" | "TARGET";

// These tables carry balances, financial events, payouts, or reward claims.
// Comparing every ordered row catches offsetting changes that aggregate sums
// and table counts alone would miss. The report contains hashes, not user data.
const criticalTables = [
  "wallet_balances",
  "ledger_transactions",
  "live_room_gift_events",
  "gift_idempotency_requests",
  "game_shared_bet_requests",
  "game_shared_bets",
  "game_shared_settlements",
  "game_round_results",
  "game_wallet_events",
  "game_daily_winner_contributions",
  "game_daily_winner_summaries",
  "live_hour_reward_decisions",
  "live_reward_entitlements",
  "live_daily_reward_awards",
  "daily_reward_claims",
  "diamond_coin_exchanges",
  "coin_purchase_requests",
  "google_play_coin_purchases",
  "withdrawal_requests",
  "withdrawal_status_history",
  "pk_host_streak_events",
  "rocket_rewards",
] as const;

function connectionConfig(side: Side) {
  const prefix = `${side}_DB_`;
  const required = ["HOST", "NAME", "USER", "PASSWORD"] as const;
  const missing = required.filter((key) => !process.env[`${prefix}${key}`]);
  if (missing.length) {
    throw new Error(`${side} database configuration is incomplete: ${missing.join(", ")}`);
  }
  return {
    host: process.env[`${prefix}HOST`],
    port: Number(process.env[`${prefix}PORT`] ?? 3306),
    database: process.env[`${prefix}NAME`],
    user: process.env[`${prefix}USER`],
    password: process.env[`${prefix}PASSWORD`],
    ssl: process.env[`${prefix}SSL`] === "true" ? { rejectUnauthorized: true } : undefined,
    connectTimeout: 10_000,
    supportBigNumbers: true,
    bigNumberStrings: true,
  };
}

async function snapshot(connection: mysql.Connection) {
  const [tableRows] = await connection.query<(RowDataPacket & { TABLE_NAME: string })[]>(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
  );
  const counts: Record<string, string> = {};
  for (const row of tableRows) {
    // Table identifiers come only from information_schema, never user input.
    const escaped = `\`${row.TABLE_NAME.replaceAll("`", "``")}\``;
    const [[count]] = await connection.query<(RowDataPacket & { count: string })[]>(
      `SELECT COUNT(*) AS count FROM ${escaped}`,
    );
    counts[row.TABLE_NAME] = String(count.count);
  }
  const rowHashes: Record<string, string> = {};
  for (const table of criticalTables) {
    if (!(table in counts)) continue;
    const [primaryKey] = await connection.query<(RowDataPacket & { COLUMN_NAME: string })[]>(
      "SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION",
      [table],
    );
    if (primaryKey.length === 0) throw new Error(`Critical table ${table} has no primary key.`);
    const orderBy = primaryKey.map((column) => `\`${column.COLUMN_NAME.replaceAll("`", "``")}\``).join(", ");
    const hash = createHash("sha256");
    let offset = 0;
    for (;;) {
      // Table identifiers are fixed in this source file; primary-key column
      // identifiers come from information_schema. A page bounds JS memory.
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT * FROM \`${table}\` ORDER BY ${orderBy} LIMIT 1000 OFFSET ${offset}`,
      );
      for (const row of rows) hash.update(JSON.stringify(row)).update("\n");
      if (rows.length < 1000) break;
      offset += rows.length;
    }
    rowHashes[table] = hash.digest("hex");
  }
  const [migrations] = await connection.query<(RowDataPacket & { name: string })[]>(
    "SELECT name FROM control_schema_migrations ORDER BY name",
  );
  const [wallet] = await connection.query<RowDataPacket[]>(
    `SELECT asset_type, COUNT(*) AS rows_count,
            CAST(COALESCE(SUM(available_balance), 0) AS CHAR) AS available_total,
            CAST(COALESCE(SUM(reserved_balance), 0) AS CHAR) AS reserved_total
       FROM wallet_balances GROUP BY asset_type ORDER BY asset_type`,
  );
  const [ledger] = await connection.query<RowDataPacket[]>(
    `SELECT asset_type, status, COUNT(*) AS rows_count,
            CAST(COALESCE(SUM(amount), 0) AS CHAR) AS amount_total
       FROM ledger_transactions GROUP BY asset_type, status ORDER BY asset_type, status`,
  );
  const normalize = (rows: RowDataPacket[]) => rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value)])),
  );
  return {
    tableCounts: counts,
    criticalRowHashes: rowHashes,
    migrationNames: migrations.map((row) => row.name),
    wallet: normalize(wallet),
    ledger: normalize(ledger),
  };
}

async function main() {
  if (process.argv.includes("--final") && process.env.MIGRATION_WRITE_FREEZE_CONFIRMED !== "true") {
    throw new Error("Final comparison requires MIGRATION_WRITE_FREEZE_CONFIRMED=true.");
  }
  const source = await mysql.createConnection(connectionConfig("SOURCE"));
  const target = await mysql.createConnection(connectionConfig("TARGET"));
  try {
    const [before, after] = await Promise.all([snapshot(source), snapshot(target)]);
    const sections = ["tableCounts", "migrationNames", "wallet", "ledger", "criticalRowHashes"] as const;
    const mismatches = sections.filter((section) =>
      JSON.stringify(before[section]) !== JSON.stringify(after[section]),
    );
    console.log(JSON.stringify({
      status: mismatches.length ? "MISMATCH" : "MATCH",
      mode: process.argv.includes("--final") ? "final" : "preliminary",
      sourceTables: Object.keys(before.tableCounts).length,
      targetTables: Object.keys(after.tableCounts).length,
      sourceMigrations: before.migrationNames.length,
      targetMigrations: after.migrationNames.length,
      mismatchedSections: mismatches,
      mismatchedCriticalTables: criticalTables.filter((table) =>
        before.criticalRowHashes[table] !== after.criticalRowHashes[table]
      ),
      // Aggregate financial totals are included for an operator to inspect,
      // but no user records or credentials are ever printed.
      sourceWallet: before.wallet,
      targetWallet: after.wallet,
      sourceLedger: before.ledger,
      targetLedger: after.ledger,
    }, null, 2));
    if (mismatches.length) process.exitCode = 1;
  } finally {
    await Promise.allSettled([source.end(), target.end()]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Comparison failed.");
  process.exitCode = 1;
});
