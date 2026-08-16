import "server-only";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { generatedRoleCode, scopeWhere } from "@/lib/db/repositories/accounts";
import type { PreparedDocument } from "@/lib/security/documents";
import type { Role, Scope } from "@/types/platform";

const creatableRoles: Record<Role, Role[]> = {
  MASTER: ["SUPER_ADMIN", "ADMIN", "AGENCY", "COIN_SELLER", "MONITORING_CS"],
  SUPER_ADMIN: ["ADMIN"],
  ADMIN: ["AGENCY"],
  AGENCY: [], COIN_SELLER: [], MONITORING_CS: [],
};

export function rolesCreatableBy(role: Role) { return creatableRoles[role]; }

export async function listPlatformAccounts(scope: Scope, role?: Role) {
  const scoped = scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(scope, "a.id");
  const [rows] = await db().query<(RowDataPacket & { id: string; role: Role; role_code: string; full_name: string; email: string | null; mobile: string | null; country_code: string | null; status: string; parent_account_id: string | null; parent_name: string | null; created_at: string; last_login_at: string | null; document_count: number })[]>(
    `SELECT a.id, a.role, a.role_code, a.full_name, a.email, a.mobile, a.country_code, a.status, a.parent_account_id,
            parent.full_name parent_name, a.created_at, a.last_login_at, COUNT(d.id) document_count
     FROM platform_accounts a LEFT JOIN platform_accounts parent ON parent.id = a.parent_account_id
     LEFT JOIN private_documents d ON d.owner_type = 'PLATFORM_ACCOUNT' AND d.owner_id = a.id
     WHERE ${scoped.clause}${role ? " AND a.role = ?" : ""}
     GROUP BY a.id ORDER BY a.created_at DESC LIMIT 200`, [...scoped.values, ...(role ? [role] : [])],
  );
  return rows.map((row) => ({ id: row.id, role: row.role, code: row.role_code, name: row.full_name, email: row.email, mobile: row.mobile, country: row.country_code, status: row.status, parentId: row.parent_account_id, parentName: row.parent_name, createdAt: row.created_at, lastLoginAt: row.last_login_at, documentCount: Number(row.document_count) }));
}

export async function listParentOptions(scope: Scope) {
  const scoped = scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(scope, "id");
  const [rows] = await db().query<(RowDataPacket & { id: string; role: Role; full_name: string; role_code: string })[]>(
    `SELECT id, role, full_name, role_code FROM platform_accounts
     WHERE ${scoped.clause} AND role IN ('SUPER_ADMIN','ADMIN') AND status = 'ACTIVE' ORDER BY role, full_name`, scoped.values,
  );
  return rows.map((row) => ({ id: row.id, role: row.role, name: row.full_name, code: row.role_code }));
}

export async function getPlatformAccountDetail(scope: Scope, accountId: string) {
  const scoped = scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(scope, "a.id");
  const [rows] = await db().query<(RowDataPacket & { id: string; role: Role; role_code: string; full_name: string; email: string | null; mobile: string | null; country_code: string | null; status: string; parent_name: string | null; created_at: string; last_login_at: string | null })[]>(
    `SELECT a.id, a.role, a.role_code, a.full_name, a.email, a.mobile, a.country_code, a.status, p.full_name parent_name, a.created_at, a.last_login_at
     FROM platform_accounts a LEFT JOIN platform_accounts p ON p.id = a.parent_account_id WHERE a.id = ? AND ${scoped.clause} LIMIT 1`,
    [accountId, ...scoped.values],
  );
  return rows[0] ? { id: rows[0].id, role: rows[0].role, code: rows[0].role_code, name: rows[0].full_name, email: rows[0].email, mobile: rows[0].mobile, country: rows[0].country_code, status: rows[0].status, parentName: rows[0].parent_name, createdAt: rows[0].created_at, lastLoginAt: rows[0].last_login_at } : null;
}

export async function listAccountDocuments(scope: Scope, accountId: string) {
  if (!(await getPlatformAccountDetail(scope, accountId))) return [];
  const [rows] = await db().query<(RowDataPacket & { id: string; document_type: string; original_name: string; byte_size: number; verification_status: string; created_at: string })[]>(
    "SELECT id, document_type, original_name, byte_size, verification_status, created_at FROM private_documents WHERE owner_type = 'PLATFORM_ACCOUNT' AND owner_id = ? ORDER BY created_at", [accountId],
  );
  return rows.map((row) => ({ id: row.id, type: row.document_type, name: row.original_name, size: Number(row.byte_size), status: row.verification_status, createdAt: row.created_at }));
}

export async function updateDocumentVerification(input: { scope: Scope; documentId: string; status: "VERIFIED" | "REJECTED"; reason: string }) {
  const [rows] = await db().query<(RowDataPacket & { id: string; owner_type: string; owner_id: string; verification_status: string })[]>("SELECT id, owner_type, owner_id, verification_status FROM private_documents WHERE id = ? LIMIT 1", [input.documentId]);
  const document = rows[0]; if (!document) throw new Error("Document was not found.");
  let permitted = false;
  if (document.owner_type === "PLATFORM_ACCOUNT") {
    const target = await getPlatformAccountDetail(input.scope, document.owner_id);
    permitted = Boolean(target) && document.owner_id !== input.scope.account.id && (
      input.scope.account.role === "MASTER" ||
      (input.scope.account.role === "SUPER_ADMIN" && target?.role === "ADMIN") ||
      (input.scope.account.role === "ADMIN" && target?.role === "AGENCY")
    );
  } else {
    permitted = Boolean(await (await import("@/lib/db/repositories/hosts")).getHostDetail(input.scope, document.owner_id));
  }
  if (!permitted) throw new Error("Document is outside your hierarchy.");
  await withTransaction(async (connection) => {
    await connection.execute("UPDATE private_documents SET verification_status = ? WHERE id = ?", [input.status, document.id]);
    await connection.execute("INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, previous_data, new_data, reason) VALUES (?, ?, ?, 'document.review', 'documents', 'private_document', ?, ?, ?, ?)", [randomUUID(), input.scope.account.id, input.scope.account.role, document.id, JSON.stringify({ status: document.verification_status }), JSON.stringify({ status: input.status }), input.reason]);
  });
}

async function resolveParent(scope: Scope, targetRole: Role, requestedParentId?: string) {
  const actorRole = scope.account.role;
  if (targetRole === "SUPER_ADMIN" || targetRole === "COIN_SELLER" || targetRole === "MONITORING_CS") return scope.account.id;
  if (targetRole === "ADMIN" && actorRole === "SUPER_ADMIN") return scope.account.id;
  if (targetRole === "AGENCY" && actorRole === "ADMIN") return scope.account.id;
  const requiredParentRole = targetRole === "ADMIN" ? "SUPER_ADMIN" : targetRole === "AGENCY" ? "ADMIN" : null;
  if (!requiredParentRole || !requestedParentId) throw new Error(`Choose the ${requiredParentRole?.replace("_", " ").toLowerCase() ?? "parent"} for this account.`);
  const scoped = scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(scope, "id");
  const [rows] = await db().query<(RowDataPacket & { id: string })[]>(
    `SELECT id FROM platform_accounts WHERE id = ? AND role = ? AND status = 'ACTIVE' AND ${scoped.clause} LIMIT 1`,
    [requestedParentId, requiredParentRole, ...scoped.values],
  );
  if (!rows[0]) throw new Error("The selected parent account is not valid in your hierarchy.");
  return rows[0].id;
}

export async function createPlatformAccount(input: { scope: Scope; role: Role; fullName: string; email?: string; mobile?: string; countryCode: string; applicationUserId?: string; password: string; requestedParentId?: string; documents: PreparedDocument[] }) {
  if (!creatableRoles[input.scope.account.role].includes(input.role)) throw new Error("Your role cannot create that account type.");
  if (input.password.length < 8) throw new Error("Password must contain at least 8 characters.");
  const parentId = await resolveParent(input.scope, input.role, input.requestedParentId);
  const accountId = randomUUID();
  const roleCode = await generatedRoleCode(input.role);
  const passwordHash = await bcrypt.hash(input.password, 12);
  await withTransaction(async (connection) => {
    await connection.execute(
      `INSERT INTO platform_accounts (id, role, role_code, full_name, application_user_id, email, mobile, password_hash, status, parent_account_id, country_code, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
      [accountId, input.role, roleCode, input.fullName, input.applicationUserId || null, input.email || null, input.mobile || null, passwordHash, parentId, input.countryCode, input.scope.account.id],
    );
    if (input.role === "COIN_SELLER") await connection.execute("INSERT INTO seller_profiles (account_id) VALUES (?)", [accountId]);
    for (const document of input.documents) {
      await connection.execute(
        `INSERT INTO private_documents (id, owner_type, owner_id, document_type, original_name, mime_type, byte_size, encrypted_data, encryption_iv, encryption_tag, uploaded_by)
         VALUES (?, 'PLATFORM_ACCOUNT', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [document.id, accountId, document.documentType, document.originalName, document.mimeType, document.byteSize, document.encryptedData, document.iv, document.tag, input.scope.account.id],
      );
    }
    await connection.execute(
      `INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, new_data, reason)
       VALUES (?, ?, ?, 'account.create', 'accounts', 'platform_account', ?, ?, 'Created through role-controlled account form')`,
      [randomUUID(), input.scope.account.id, input.scope.account.role, accountId, JSON.stringify({ role: input.role, roleCode, parentId })],
    );
  });
  return { accountId, roleCode };
}

export async function updateAccountStatus(input: { scope: Scope; accountId: string; nextStatus: "ACTIVE" | "SUSPENDED" | "DISABLED"; reason: string }) {
  if (input.accountId === input.scope.account.id) throw new Error("You cannot change your own account status.");
  const scoped = input.scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(input.scope, "id");
  await withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { id: string; role: Role; status: string })[]>(
      `SELECT id, role, status FROM platform_accounts WHERE id = ? AND ${scoped.clause} FOR UPDATE`, [input.accountId, ...scoped.values],
    );
    const target = rows[0];
    if (!target || target.role === "MASTER") throw new Error("That account cannot be managed in your scope.");
    const manageable = input.scope.account.role === "MASTER" || (input.scope.account.role === "SUPER_ADMIN" && target.role === "ADMIN") || (input.scope.account.role === "ADMIN" && target.role === "AGENCY");
    if (!manageable) throw new Error("Your role cannot manage that account.");
    await connection.execute("UPDATE platform_accounts SET status = ? WHERE id = ?", [input.nextStatus, target.id]);
    await connection.execute("INSERT INTO account_status_history (id, account_id, from_status, to_status, reason, actor_account_id) VALUES (?, ?, ?, ?, ?, ?)", [randomUUID(), target.id, target.status, input.nextStatus, input.reason, input.scope.account.id]);
    await connection.execute(
      `INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, previous_data, new_data, reason)
       VALUES (?, ?, ?, 'account.status_change', 'accounts', 'platform_account', ?, ?, ?, ?)`,
      [randomUUID(), input.scope.account.id, input.scope.account.role, target.id, JSON.stringify({ status: target.status }), JSON.stringify({ status: input.nextStatus }), input.reason],
    );
  });
}

export async function resetAccountPassword(input: { scope: Scope; accountId: string; password: string; reason: string }) {
  if (input.accountId === input.scope.account.id) throw new Error("Use the self-service password flow for your own account.");
  const scoped = input.scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(input.scope, "id");
  const [rows] = await db().query<(RowDataPacket & { id: string; role: Role })[]>(`SELECT id, role FROM platform_accounts WHERE id = ? AND ${scoped.clause} LIMIT 1`, [input.accountId, ...scoped.values]);
  const target = rows[0];
  const manageable = target && target.role !== "MASTER" && (input.scope.account.role === "MASTER" || (input.scope.account.role === "SUPER_ADMIN" && target.role === "ADMIN") || (input.scope.account.role === "ADMIN" && target.role === "AGENCY"));
  if (!manageable) throw new Error("That account cannot be managed in your scope.");
  const hash = await bcrypt.hash(input.password, 12);
  await withTransaction(async (connection) => {
    await connection.execute("UPDATE platform_accounts SET password_hash = ? WHERE id = ?", [hash, input.accountId]);
    await connection.execute("INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, reason) VALUES (?, ?, ?, 'account.password_reset', 'accounts', 'platform_account', ?, ?)", [randomUUID(), input.scope.account.id, input.scope.account.role, input.accountId, input.reason]);
  });
}
