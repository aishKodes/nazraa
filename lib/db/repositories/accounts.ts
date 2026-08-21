import "server-only";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { scopedAccountsSql } from "@/lib/db/queries/sql";
import type { PlatformAccount, Role, Scope } from "@/types/platform";

type AccountRow = RowDataPacket & {
  id: string;
  public_id: number;
  role: Role;
  role_code: string;
  full_name: string;
  email: string | null;
  mobile: string | null;
  status: PlatformAccount["status"];
  parent_account_id: string | null;
  password_hash?: string;
};

function mapAccount(row: AccountRow): PlatformAccount {
  return {
    id: row.id,
    publicId: String(row.public_id),
    role: row.role,
    roleCode: row.role_code,
    fullName: row.full_name,
    email: row.email,
    mobile: row.mobile,
    status: row.status,
    parentAccountId: row.parent_account_id,
  };
}

export async function accountByManagementId(publicId: string) {
  const [rows] = await db().execute<AccountRow[]>(
    `SELECT id, public_id, role, role_code, full_name, email, mobile, status, parent_account_id, password_hash
     FROM platform_accounts WHERE public_id = ? LIMIT 1`,
    [Number(publicId)],
  );
  return rows[0] ? { ...mapAccount(rows[0]), passwordHash: rows[0].password_hash! } : null;
}

export async function accountById(id: string) {
  const [rows] = await db().execute<AccountRow[]>(
    `SELECT id, public_id, role, role_code, full_name, email, mobile, status, parent_account_id
     FROM platform_accounts WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ? mapAccount(rows[0]) : null;
}

export async function createInitialMaster(input: { publicId: number; fullName: string; password: string }) {
  const [masters] = await db().query<(RowDataPacket & { value: number })[]>(
    "SELECT COUNT(*) value FROM platform_accounts WHERE role = 'MASTER'",
  );
  if (Number(masters[0]?.value ?? 0) > 0) return false;
  const passwordHash = await bcrypt.hash(input.password, 12);
  await withTransaction(async (connection) => {
    if (!Number.isInteger(input.publicId) || input.publicId < 100000 || input.publicId > 999999) throw new Error("Initial Master ID must be six digits.");
    const [collisions] = await connection.query<RowDataPacket[]>("SELECT id FROM platform_accounts WHERE public_id = ? LIMIT 1", [input.publicId]);
    if (collisions.length) throw new Error("Initial Master ID is already in use.");
    const roleCode = await generatedRoleCode("MASTER");
    await connection.execute(
      `INSERT INTO platform_accounts (id, public_id, role, role_code, full_name, password_hash, status)
       SELECT ?, ?, 'MASTER', ?, ?, ?, 'ACTIVE'
       WHERE NOT EXISTS (SELECT 1 FROM platform_accounts WHERE role = 'MASTER')`,
      [randomUUID(), input.publicId, roleCode, input.fullName, passwordHash],
    );
  });
  return true;
}

export async function scopeFor(account: Scope["account"]): Promise<Scope> {
  if (account.role === "MASTER" || account.role === "MONITORING_CS") return { account, accountIds: [], isGlobal: true };
  const [rows] = await db().query<(RowDataPacket & { id: string })[]>(scopedAccountsSql, [account.id]);
  return { account, accountIds: rows.map((row) => row.id), isGlobal: false };
}

export function scopeWhere(scope: Scope, column: string) {
  if (scope.isGlobal) return { clause: "1=1", values: [] as string[] };
  if (!scope.accountIds.length) return { clause: "1=0", values: [] as string[] };
  return { clause: `${column} IN (${scope.accountIds.map(() => "?").join(",")})`, values: scope.accountIds };
}

const codePrefix: Record<Role, string> = {
  MASTER: "MST",
  SUPER_ADMIN: "SA",
  ADMIN: "ADM",
  AGENCY: "AG",
  COIN_SELLER: "CS",
  MONITORING_CS: "MCS",
};

export async function generatedRoleCode(role: Role) {
  const code = `${codePrefix[role]}-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  return code;
}
