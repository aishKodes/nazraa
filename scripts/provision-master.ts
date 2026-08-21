import "dotenv/config";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

async function main() {
  const publicIdValue = process.env.INITIAL_MASTER_PUBLIC_ID?.trim();
  const password = process.env.INITIAL_MASTER_PASSWORD;
  const fullName = process.env.INITIAL_MASTER_NAME?.trim() || "Nazraa Master";

  if (!publicIdValue && !password) {
    console.log("Master provisioning skipped: deployment credentials are not present in this environment.");
    return;
  }
  if (!/^\d{6}$/.test(publicIdValue ?? "") || !password || password.length < 16) {
    throw new Error("INITIAL_MASTER_PUBLIC_ID must be six digits and INITIAL_MASTER_PASSWORD must contain at least 16 characters.");
  }

  const required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required environment values: ${missing.join(", ")}`);

  const publicId = Number(publicIdValue);
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  });

  let lockHeld = false;
  try {
    const [lockRows] = await connection.query<mysql.RowDataPacket[]>("SELECT GET_LOCK('nazraa_master_provision', 30) acquired");
    lockHeld = Number(lockRows[0]?.acquired ?? 0) === 1;
    if (!lockHeld) throw new Error("Could not acquire the Master provisioning lock.");
    await connection.beginTransaction();
    const [masters] = await connection.query<(mysql.RowDataPacket & { id: string })[]>(
      "SELECT id FROM platform_accounts WHERE role = 'MASTER' FOR UPDATE",
    );
    if (masters.length > 1) throw new Error("Multiple Master accounts exist; refusing to choose one automatically.");
    const [collisions] = await connection.query<(mysql.RowDataPacket & { id: string })[]>(
      "SELECT id FROM platform_accounts WHERE public_id = ? AND role <> 'MASTER' LIMIT 1 FOR UPDATE",
      [publicId],
    );
    if (collisions.length) throw new Error("The selected Master management ID is already in use.");

    const passwordHash = await bcrypt.hash(password, 12);
    if (masters[0]) {
      await connection.execute(
        "UPDATE platform_accounts SET public_id = ?, full_name = ?, password_hash = ?, status = 'ACTIVE', parent_account_id = NULL WHERE id = ?",
        [publicId, fullName, passwordHash, masters[0].id],
      );
    } else {
      const roleCode = `MST-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
      await connection.execute(
        "INSERT INTO platform_accounts (id, public_id, role, role_code, full_name, password_hash, status) VALUES (?, ?, 'MASTER', ?, ?, ?, 'ACTIVE')",
        [randomUUID(), publicId, roleCode, fullName, passwordHash],
      );
    }
    await connection.commit();
    console.log(`Master account provisioned. Management ID: ${publicId}`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    if (lockHeld) await connection.query("SELECT RELEASE_LOCK('nazraa_master_provision')");
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
