import { readFileSync, statSync } from "node:fs";
import { parse } from "dotenv";

// Run in a disposable Node container on the private VPS network. Neither
// credential file nor any record value is printed by this wrapper.
const [sourcePath, targetPath, targetSchema] = process.argv.slice(2);
if (!sourcePath || !targetPath || !/^nazraa_(?:fresh|final_[0-9]{8}_[0-9]{6})$/.test(targetSchema ?? "")) {
  throw new Error("Expected source.env target.env nazraa_fresh|nazraa_final_YYYYMMDD_HHMMSS.");
}
function privateEnvironment(path) {
  const stat = statSync(path);
  if ((stat.mode & 0o077) !== 0) throw new Error("Database credential file is not private.");
  return parse(readFileSync(path));
}

const source = privateEnvironment(sourcePath);
const target = privateEnvironment(targetPath);
for (const key of ["HOST", "USER", "PASSWORD", "NAME"]) {
  if (!source[`DB_${key}`]) throw new Error(`Source DB_${key} is missing.`);
  if (key !== "HOST" && key !== "NAME" && !target[`DB_${key}`]) {
    throw new Error(`Target DB_${key} is missing.`);
  }
  process.env[`SOURCE_DB_${key}`] = source[`DB_${key}`];
}
process.env.SOURCE_DB_PORT = source.DB_PORT ?? "3306";
process.env.SOURCE_DB_SSL = source.DB_SSL ?? "false";
process.env.TARGET_DB_HOST = "mysql";
process.env.TARGET_DB_PORT = "3306";
process.env.TARGET_DB_NAME = targetSchema;
process.env.TARGET_DB_USER = target.DB_USER;
process.env.TARGET_DB_PASSWORD = target.DB_PASSWORD;
process.env.TARGET_DB_SSL = "false";
if (process.argv.includes("--final")) {
  process.env.MIGRATION_WRITE_FREEZE_CONFIRMED = "true";
}
await import("./compare-databases.ts");
