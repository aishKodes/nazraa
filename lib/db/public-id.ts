import "server-only";

import { randomInt } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

export async function generateManagementPublicId(connection: PoolConnection) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = randomInt(100000, 1000000);
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM platform_accounts WHERE public_id = ? LIMIT 1",
      [candidate],
    );
    if (!rows.length) return candidate;
  }
  throw new Error("A unique six-digit management ID could not be allocated.");
}
