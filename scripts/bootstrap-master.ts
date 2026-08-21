import "dotenv/config";
import { randomInt, randomUUID } from "crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

async function main() {
  const required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required environment values: ${missing.join(", ")}`);

  const prompt = createInterface({ input, output });
  const fullName = (await prompt.question("Master full name: ")).trim();
  const password = process.env.MASTER_PASSWORD ?? await prompt.question("Master password (input visible; use MASTER_PASSWORD to avoid this): ");
  prompt.close();

  if (!fullName || password.length < 12) {
    throw new Error("Name is required; password must have at least 12 characters.");
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  });
  try {
    const hash = await bcrypt.hash(password, 12);
    let publicId = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const candidate = randomInt(100000, 1000000);
      const [rows] = await connection.query<mysql.RowDataPacket[]>("SELECT id FROM platform_accounts WHERE public_id = ? LIMIT 1", [candidate]);
      if (!rows.length) { publicId = candidate; break; }
    }
    if (!publicId) throw new Error("A unique six-digit management ID could not be allocated.");
    const roleCode = `MST-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    await connection.execute(
      `INSERT INTO platform_accounts (id, public_id, role, role_code, full_name, password_hash, status)
       VALUES (?, ?, 'MASTER', ?, ?, ?, 'ACTIVE')`,
      [randomUUID(), publicId, roleCode, fullName, hash],
    );
    console.log(`Master account created. Management ID: ${publicId}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
