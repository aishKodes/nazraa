import "server-only";
import mysql, { type PoolOptions } from "mysql2/promise";

declare global {
  var nazraaPool: mysql.Pool | undefined;
}

function databaseConfig(): PoolOptions {
  const required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"] as const;
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Database is not configured. Missing ${missing.join(", ")}.`);
  }

  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: 8,
    maxIdle: 4,
    idleTimeout: 60_000,
    queueLimit: 0,
    decimalNumbers: true,
    timezone: "Z",
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  };
}

export function db() {
  if (!global.nazraaPool) {
    global.nazraaPool = mysql.createPool(databaseConfig());
  }
  return global.nazraaPool;
}
