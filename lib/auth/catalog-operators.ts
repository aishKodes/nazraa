import "server-only";
import { cache } from "react";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { scopeFor } from "@/lib/db/repositories/accounts";
import type { SessionAccount, Scope } from "@/types/platform";

const settingKey = "control.catalog_operators";
export type CatalogOperatorAccess = { games: boolean; gifts: boolean };
const none: CatalogOperatorAccess = { games: false, gifts: false };
const full: CatalogOperatorAccess = { games: true, gifts: true };

function decode(value: unknown): Record<string, CatalogOperatorAccess> {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

export const catalogOperatorAccess = cache(async (account: SessionAccount): Promise<CatalogOperatorAccess> => {
  if (account.role === "MASTER") return full;
  if (account.role !== "ADMIN" || (await scopeFor(account)).globalManagerId) return none;
  const [rows] = await db().query<RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key=?", [settingKey]);
  const grant = decode(rows[0]?.setting_value)[account.id];
  return { games: grant?.games === true, gifts: grant?.gifts === true };
});

export async function requireCatalogOperator(scope: Scope, capability: keyof CatalogOperatorAccess) {
  if (!(await catalogOperatorAccess(scope.account))[capability]) {
    throw Error("Only Master or an explicitly authorized Admin may manage this catalog.");
  }
}

export async function setCatalogOperator(
  scope: Scope, publicId: string, access: CatalogOperatorAccess, reason: string,
) {
  if (scope.account.role !== "MASTER") throw Error("Only Master may delegate catalog access.");
  if (!/^\d{6}$/.test(publicId) || reason.trim().length < 5 || reason.trim().length > 500) {
    throw Error("Enter an Admin management ID and an audit reason of 5–500 characters.");
  }
  await withTransaction(async connection => {
    const [accounts] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM platform_accounts WHERE public_id=? AND role='ADMIN' AND removed_at IS NULL AND status='ACTIVE' FOR UPDATE", [publicId],
    );
    if (!accounts[0]) throw Error("Active Admin account not found.");
    const id = String(accounts[0].id);
    await connection.execute("INSERT IGNORE INTO system_settings(setting_key,setting_value,updated_by) VALUES(?,'{}',?)", [settingKey, scope.account.id]);
    const [rows] = await connection.query<RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key=? FOR UPDATE", [settingKey]);
    const grants = decode(rows[0]?.setting_value);
    const previous = grants[id] ?? none;
    if (access.games || access.gifts) grants[id] = access;
    else delete grants[id];
    await connection.execute("UPDATE system_settings SET setting_value=?,updated_by=? WHERE setting_key=?",
      [JSON.stringify(grants), scope.account.id, settingKey]);
    await connection.execute(
      `INSERT INTO audit_logs(id,actor_account_id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason)
       VALUES(?,?,'MASTER','control.catalog_operator','settings','platform_account',?,?,?,?)`,
      [randomUUID(), scope.account.id, id, JSON.stringify(previous), JSON.stringify(access), reason.trim()],
    );
  });
}
