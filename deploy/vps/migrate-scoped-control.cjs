// Run inside the existing production image with /source mounted read-only.
// This is deliberately restricted to the two owner-approved Control migrations.
const { createRequire } = require("node:module");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const mysql = createRequire("/app/package.json")("mysql2/promise");
const allowed = ["0098_face_live_temporary_suspension.sql", "0099_banner_optimized_size.sql"];
async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    multipleStatements: true, timezone: "Z", charset: "utf8mb4_general_ci",
  });
  try {
    const [applied] = await connection.query("SELECT name FROM control_schema_migrations");
    const known = new Set(applied.map(row => row.name));
    const directory = path.resolve(__dirname, "../../db/migrations");
    const pending = readdirSync(directory).filter(name => name.endsWith(".sql") && !known.has(name)).sort();
    if (pending.some(name => !allowed.includes(name))) throw new Error("Unexpected pending migration: stop before changing production.");
    console.log("Pending scoped migrations:", pending.join(", ") || "none");
    if (process.argv.includes("--check")) return;
    for (const name of pending) {
      await connection.query(readFileSync(path.join(directory, name), "utf8"));
      await connection.execute("INSERT INTO control_schema_migrations (name) VALUES (?)", [name]);
      console.log("Applied", name);
    }
  } finally { await connection.end(); }
}
main().catch(error => {
  // Do not log SQL, connection configuration or credentials.
  console.error("Scoped migration failed:", error.code || error.message);
  process.exitCode = 1;
});
