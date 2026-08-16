import "dotenv/config";
import { randomUUID } from "crypto";
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
  const roleCode = (await prompt.question("Master role code (e.g. MST-NAZRAA): ")).trim().toUpperCase();
  const password = process.env.MASTER_PASSWORD ?? await prompt.question("Master password (input visible; use MASTER_PASSWORD to avoid this): ");
  prompt.close();

  if (!fullName || !roleCode || password.length < 12) {
    throw new Error("Name and role code are required; password must have at least 12 characters.");
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
    await connection.execute(
      `INSERT INTO platform_accounts (id, role, role_code, full_name, password_hash, status)
       VALUES (?, 'MASTER', ?, ?, ?, 'ACTIVE')`,
      [randomUUID(), roleCode, fullName, hash],
    );
    console.log("Master account created.");
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
