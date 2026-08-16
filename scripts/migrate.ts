import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

async function main() {
  const required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required environment values: ${missing.join(", ")}`);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306), database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, multipleStatements: true,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  });
  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS control_schema_migrations (
      name VARCHAR(255) PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`);
    const migrationsDirectory = path.join(process.cwd(), "db", "migrations");
    const migrationNames = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
    for (const name of migrationNames) {
      const [existing] = await connection.query<mysql.RowDataPacket[]>("SELECT name FROM control_schema_migrations WHERE name = ?", [name]);
      if (existing.length) continue;
      await connection.beginTransaction();
      try {
        await connection.query(await readFile(path.join(migrationsDirectory, name), "utf8"));
        await connection.execute("INSERT INTO control_schema_migrations (name) VALUES (?)", [name]);
        await connection.commit();
        console.log(`Applied ${name}`);
      } catch (error) { await connection.rollback(); throw error; }
    }
  } finally { await connection.end(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
