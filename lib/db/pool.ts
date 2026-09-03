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
    // Hostinger's existing schema uses utf8mb4_general_ci. MariaDB treats
    // bound values and SQL literals as connection-collated strings; using a
    // different connection collation made even expressions such as
    // `? = 'PARTY'` fail with ER_CANT_AGGREGATE_2COLLATIONS.
    charset: "utf8mb4_general_ci",
    waitForConnections: true,
    // Hostinger is a remote shared MySQL service. A Vercel cold start opening
    // eight sockets at once was intermittently timing out login and mobile
    // bootstrap. Keep a small warm pool and queue the short queries instead.
    connectionLimit: Math.min(2, Math.max(1, Number(process.env.DB_CONNECTION_LIMIT ?? 1))),
    maxIdle: 1,
    // Keep the single socket across warm Fluid-compute invocations. Hostinger
    // limits new connections per hour, so rapidly discarding healthy sockets
    // makes an otherwise healthy database appear offline.
    idleTimeout: 10 * 60_000,
    queueLimit: 100,
    connectTimeout: 12_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
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

const transientCodes = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
  "PROTOCOL_ENQUEUE_AFTER_QUIT",
]);

export function isTransientDatabaseError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const syscall = "syscall" in error ? String(error.syscall) : "";
  const message = "message" in error ? String(error.message) : "";
  return (
    transientCodes.has(code) ||
    (code === "ETIMEDOUT" && syscall === "connect") ||
    /pool is closed/i.test(message)
  );
}

export function isDatabaseAvailabilityError(error: unknown) {
  if (isTransientDatabaseError(error)) return true;
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  return code === "ER_USER_LIMIT_REACHED" || code === "ER_CON_COUNT_ERROR";
}

function discardPool() {
  const pool = global.nazraaPool;
  global.nazraaPool = undefined;
  if (!pool) return;

  // A warm Vercel instance can serve concurrent requests. Ending the shared
  // pool immediately here interrupts requests that already borrowed it and
  // turns one connection timeout into a burst of `Pool is closed` failures.
  // Detach it now so retries receive a fresh pool, then close it only after
  // in-flight work has had time to finish.
  const closeTimer = setTimeout(() => {
    void pool.end().catch(() => undefined);
  }, 60_000);
  closeTimer.unref();
}

/** Retry connection/read failures only. Never wrap a non-idempotent mutation. */
export async function withDatabaseReadRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseError(error) || attempt === attempts) throw error;
      discardPool();
      await new Promise((resolve) => setTimeout(resolve, 120 * attempt));
    }
  }
  throw lastError;
}

export async function getDatabaseConnection() {
  return withDatabaseReadRetry(() => db().getConnection());
}
