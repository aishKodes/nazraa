import "server-only";
import type { PoolConnection } from "mysql2/promise";
import { getDatabaseConnection } from "@/lib/db/pool";
import { recordDatabaseAcquire, recordDatabaseQuery, recordDatabaseTransaction } from "@/lib/observability/mobile-latency-context";

function tracedConnection(connection: PoolConnection): PoolConnection {
  return new Proxy(connection, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property === "query" || property === "execute") {
        return async (...argumentsList: unknown[]) => {
          const startedAt = performance.now();
          try {
            return await (value as (...args: unknown[]) => unknown).apply(target, argumentsList);
          } finally {
            recordDatabaseQuery(performance.now() - startedAt);
          }
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as PoolConnection;
}

export async function withTransaction<T>(operation: (connection: PoolConnection) => Promise<T>) {
  // Retrying acquisition is safe because the transaction has not started.
  // The operation itself is deliberately never replayed.
  const acquisitionStartedAt = performance.now();
  const connection = await getDatabaseConnection();
  recordDatabaseAcquire(performance.now() - acquisitionStartedAt);
  const transactionStartedAt = performance.now();
  try {
    await connection.beginTransaction();
    const result = await operation(tracedConnection(connection));
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    recordDatabaseTransaction(performance.now() - transactionStartedAt);
    connection.release();
  }
}

/**
 * Retry only a transaction whose public request has a durable idempotency key.
 * MySQL selects a deadlock victim and rolls it back, so replaying that exact
 * keyed request is safe. Unkeyed financial mutations must use withTransaction.
 */
export async function withIdempotentTransaction<T>(operation: (connection: PoolConnection) => Promise<T>, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await withTransaction(operation);
    } catch (error) {
      lastError = error;
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (!new Set(["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]).has(code) || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
  throw lastError;
}
