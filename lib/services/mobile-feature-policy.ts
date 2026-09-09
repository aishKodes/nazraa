import "server-only";

import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";

function objectValue(value: unknown): Record<string, unknown> {
  if (Buffer.isBuffer(value)) {
    try { return JSON.parse(value.toString("utf8")) as Record<string, unknown>; } catch { return {}; }
  }
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function creatorCashWithdrawalsEnabled(connection?: PoolConnection) {
  if (process.env.NODE_ENV !== "production" && process.env.NAZRAA_TEST_CREATOR_CASH_WITHDRAWALS === "enabled") return true;
  const executor = connection ?? db();
  const [rows] = await executor.query<(RowDataPacket & { setting_value: unknown })[]>(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.features' LIMIT 1",
  );
  const features = objectValue(rows[0]?.setting_value);
  // Play v1 is fail-closed. Missing/malformed configuration must never expose
  // a cash-out endpoint to an older mobile client.
  const enabled = (value: unknown) => value === true || value === 1 || value === "true";
  return enabled(features.creatorCashWithdrawalsEnabled) && enabled(features.withdrawalEnabled);
}

export async function assertCreatorCashWithdrawalsEnabled(connection?: PoolConnection) {
  if (!await creatorCashWithdrawalsEnabled(connection)) {
    throw Object.assign(
      new Error("Cash withdrawal is not available in this version of Nazraa."),
      { code: "CREATOR_CASH_WITHDRAWALS_DISABLED" },
    );
  }
}
