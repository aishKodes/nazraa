import "server-only";
import type { PoolConnection } from "mysql2/promise";
import { db } from "@/lib/db/pool";

export async function withTransaction<T>(operation: (connection: PoolConnection) => Promise<T>) {
  const connection = await db().getConnection();
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
