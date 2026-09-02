import "server-only";
import type { PoolConnection } from "mysql2/promise";
import { getDatabaseConnection } from "@/lib/db/pool";

export async function withTransaction<T>(operation: (connection: PoolConnection) => Promise<T>) {
  // Retrying acquisition is safe because the transaction has not started.
  // The operation itself is deliberately never replayed.
  const connection = await getDatabaseConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
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
