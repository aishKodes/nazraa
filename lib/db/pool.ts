import "server-only";
import mysql, { type PoolOptions } from "mysql2/promise";
import { recordDatabaseQuery } from "@/lib/observability/mobile-latency-context";

declare global {
  var nazraaPool: mysql.Pool | undefined;
  var nazraaInstrumentedPool: mysql.Pool | undefined;
}

function databaseConfig(): PoolOptions {
  const required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"] as const;
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(
      `Database is not configured. Missing ${missing.join(", ")}.`,
    );
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
    // Two short-lived connections per warm function let a room heartbeat
    // complete while an unrelated bootstrap/read is waiting on Hostinger. It
    // is still deliberately capped at two: Vercel can scale horizontally and
    // the shared production database has a finite per-user connection limit.
    connectionLimit: Math.min(
      2,
      Math.max(1, Number(process.env.DB_CONNECTION_LIMIT ?? 2)),
    ),
    maxIdle: 2,
    // Hostinger's shared MariaDB can retire an inactive remote socket far
    // sooner than a warm Vercel function is recycled. Reusing that half-closed
    // socket left public config and sign-in requests waiting forever. Retire
    // the pool's idle connection before the provider can do so; active work is
    // still queued on the small pool rather than creating a connection burst.
    idleTimeout: 5_000,
    // Presence is retryable and should wait briefly behind a slow database
    // read instead of failing a healthy room with mysql2's "Queue limit
    // reached" error.  The bounded value prevents unbounded memory growth;
    // the platform timeout remains the final back-pressure guard.
    queueLimit: Math.min(
      500,
      Math.max(100, Number(process.env.DB_QUEUE_LIMIT ?? 250)),
    ),
    connectTimeout: 12_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    decimalNumbers: true,
    timezone: "Z",
    ssl:
      process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  };
}

export function db() {
  if (!global.nazraaPool) {
    global.nazraaPool = mysql.createPool(databaseConfig());
    global.nazraaInstrumentedPool = new Proxy(global.nazraaPool, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property === "query" || property === "execute") {
          return async (...argumentsList: unknown[]) => {
            const startedAt = performance.now();
            try {
              return await (value as (...args: unknown[]) => unknown).apply(
                target,
                argumentsList,
              );
            } finally {
              // This records duration only inside an active mobile request.
              // It deliberately never retries or changes SQL/write semantics.
              recordDatabaseQuery(performance.now() - startedAt);
            }
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as mysql.Pool;
  }
  return global.nazraaInstrumentedPool!;
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
  global.nazraaInstrumentedPool = undefined;
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
export async function withDatabaseReadRetry<T>(
  operation: () => Promise<T>,
  attempts = 3,
): Promise<T> {
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
