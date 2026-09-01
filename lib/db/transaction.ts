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
