import "dotenv/config";
import mysql, { type RowDataPacket } from "mysql2/promise";

type Side = "SOURCE" | "TARGET";

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
    const sections = ["tableCounts", "migrationNames", "wallet", "ledger"] as const;
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
