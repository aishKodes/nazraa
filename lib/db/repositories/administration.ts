import "server-only";

import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2";
import { canManageRole, isParentRoleValid, roleLabel, rolesAssignableBy, rolesCreatableBy, validParentRoles } from "@/lib/auth/role-hierarchy";
import { db } from "@/lib/db/pool";
import { generateManagementPublicId } from "@/lib/db/public-id";
import { generatedRoleCode, scopeWhere } from "@/lib/db/repositories/accounts";
import { withTransaction } from "@/lib/db/transaction";
import type { PreparedDocument } from "@/lib/security/documents";
import type { PageRequest, PageResult, Role, Scope } from "@/types/platform";

export { rolesCreatableBy } from "@/lib/auth/role-hierarchy";

type AccountRow = RowDataPacket & {
  id: string;
  public_id: number;
  role: Role;
  full_name: string;
  email: string | null;
  mobile: string | null;
  country_code: string | null;
  status: string;
  parent_account_id: string | null;
  parent_name: string | null;
  created_at: string;
  last_login_at: string | null;
  document_count: number;
};

function mapAccount(row: AccountRow) {
  return {
    id: row.id,
    role: row.role,
    displayRole: roleLabel(row.role),
    code: String(row.public_id),
    name: row.full_name,
    email: row.email,
    mobile: row.mobile,
    country: row.country_code,
    status: row.status,
    parentId: row.parent_account_id,
    parentName: row.parent_name,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    documentCount: Number(row.document_count),
  };
}

function normalizedPage(input: PageRequest = {}) {
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(50, Math.max(10, Math.trunc(input.pageSize ?? 25)));
  return { page, pageSize, offset: (page - 1) * pageSize, search: input.search?.trim().slice(0, 120) || "" };
}

function accountSelect(where: string) {
  return `SELECT a.id, a.public_id, a.role, a.full_name, a.email, a.mobile, a.country_code,
                 a.status, a.parent_account_id, parent.full_name parent_name, a.created_at,
                 a.last_login_at, COALESCE(documents.document_count, 0) document_count
          FROM platform_accounts a
          LEFT JOIN platform_accounts parent ON parent.id = a.parent_account_id
          LEFT JOIN (
            SELECT owner_id, COUNT(*) document_count
            FROM private_documents
            WHERE owner_type = 'PLATFORM_ACCOUNT'
            GROUP BY owner_id
          ) documents ON documents.owner_id = a.id
          WHERE ${where}`;
}

export async function listPlatformAccounts(scope: Scope, role?: Role, limit = 250) {
  const scoped = scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(scope, "a.id");
  const safeLimit = Math.min(500, Math.max(1, Math.trunc(limit)));
  const [rows] = await db().query<AccountRow[]>(
    `${accountSelect(`${scoped.clause}${role ? " AND a.role = ?" : ""}`)}
     ORDER BY a.created_at DESC LIMIT ?`,
    [...scoped.values, ...(role ? [role] : []), safeLimit],
  );
  return rows.map(mapAccount);
}

export async function listPlatformAccountsPage(
  scope: Scope,
  input: PageRequest & { role?: Role } = {},
): Promise<PageResult<ReturnType<typeof mapAccount>>> {
  const { page, pageSize, offset, search } = normalizedPage(input);
  const scoped = scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(scope, "a.id");
  const filters = [scoped.clause];
  const values: unknown[] = [...scoped.values];
  if (input.role) {
    filters.push("a.role = ?");
    values.push(input.role);
  }
  if (search) {
    if (/^\d{1,6}$/.test(search)) {
      filters.push("a.public_id = ?");
      values.push(Number(search));
    } else {
      filters.push("(a.full_name LIKE ? OR a.mobile LIKE ? OR a.email LIKE ?)");
      const prefix = `${search}%`;
      values.push(prefix, prefix, prefix);
    }
  }
  const [rows] = await db().query<AccountRow[]>(
    `${accountSelect(filters.join(" AND "))}
     ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [...values, pageSize + 1, offset],
  );
  return { items: rows.slice(0, pageSize).map(mapAccount), page, pageSize, hasNext: rows.length > pageSize };
}

export async function listParentOptions(scope: Scope, childRole?: Role) {
  const scoped = scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(scope, "id");
  const allowedRoles = childRole ? validParentRoles(childRole) : ["MASTER", "COUNTRY_MANAGER", "SUPER_ADMIN", "ADMIN", "BD"] satisfies Role[];
  if (!allowedRoles.length) return [];
  const placeholders = allowedRoles.map(() => "?").join(",");
  const [rows] = await db().query<(RowDataPacket & { id: string; role: Role; full_name: string; public_id: number; country_code: string | null })[]>(
    `SELECT id, role, full_name, public_id, country_code FROM platform_accounts
     WHERE ${scoped.clause} AND role IN (${placeholders}) AND status = 'ACTIVE'
     ORDER BY FIELD(role, 'MASTER','COUNTRY_MANAGER','SUPER_ADMIN','ADMIN','BD'), full_name LIMIT 500`,
    [...scoped.values, ...allowedRoles],
  );
  return rows.map((row) => ({ id: row.id, role: row.role, displayRole: roleLabel(row.role), name: row.full_name, code: String(row.public_id), country: row.country_code }));
}

export async function getPlatformAccountDetail(scope: Scope, accountId: string) {
  const scoped = scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(scope, "a.id");
  const [rows] = await db().query<AccountRow[]>(
    `${accountSelect(`a.id = ? AND ${scoped.clause}`)} LIMIT 1`,
    [accountId, ...scoped.values],
  );
  return rows[0] ? mapAccount(rows[0]) : null;
}

export async function listAccountDocuments(scope: Scope, accountId: string) {
  if (!(await getPlatformAccountDetail(scope, accountId))) return [];
  const [rows] = await db().query<(RowDataPacket & { id: string; document_type: string; original_name: string; byte_size: number; verification_status: string; created_at: string })[]>(
    "SELECT id, document_type, original_name, byte_size, verification_status, created_at FROM private_documents WHERE owner_type = 'PLATFORM_ACCOUNT' AND owner_id = ? ORDER BY created_at LIMIT 50",
    [accountId],
  );
  return rows.map((row) => ({ id: row.id, type: row.document_type, name: row.original_name, size: Number(row.byte_size), status: row.verification_status, createdAt: row.created_at }));
}

export async function updateDocumentVerification(input: { scope: Scope; documentId: string; status: "VERIFIED" | "REJECTED"; reason: string }) {
  const [rows] = await db().query<(RowDataPacket & { id: string; owner_type: string; owner_id: string; verification_status: string })[]>(
    "SELECT id, owner_type, owner_id, verification_status FROM private_documents WHERE id = ? LIMIT 1",
    [input.documentId],
  );
  const document = rows[0];
  if (!document) throw new Error("Document was not found.");
  let permitted = false;
  if (document.owner_type === "PLATFORM_ACCOUNT") {
    const target = await getPlatformAccountDetail(input.scope, document.owner_id);
    permitted = Boolean(target) && document.owner_id !== input.scope.account.id && Boolean(target && canManageRole(input.scope.account.role, target.role));
  } else {
    permitted = Boolean(await (await import("@/lib/db/repositories/hosts")).getHostDetail(input.scope, document.owner_id));
  }
  if (!permitted) throw new Error("Document is outside your hierarchy.");
  await withTransaction(async (connection) => {
    await connection.execute("UPDATE private_documents SET verification_status = ? WHERE id = ?", [input.status, document.id]);
    await connection.execute(
      "INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, previous_data, new_data, reason) VALUES (?, ?, ?, 'document.review', 'documents', 'private_document', ?, ?, ?, ?)",
      [randomUUID(), input.scope.account.id, input.scope.account.role, document.id, JSON.stringify({ status: document.verification_status }), JSON.stringify({ status: input.status }), input.reason],
    );
  });
}

async function resolveParent(scope: Scope, targetRole: Role, requestedParentId?: string) {
  if (targetRole === "MASTER") throw new Error("Another Master account cannot be created.");
  const automaticParent = isParentRoleValid(targetRole, scope.account.role) ? scope.account.id : undefined;
  const parentId = requestedParentId || automaticParent;
  const allowedParents = validParentRoles(targetRole);
  if (!parentId) throw new Error(`Choose an active ${allowedParents.map(roleLabel).join(" or ")} parent.`);
  const scoped = scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(scope, "id");
  const [rows] = await db().query<(RowDataPacket & { id: string; role: Role; country_code: string | null })[]>(
    `SELECT id, role, country_code FROM platform_accounts
     WHERE id = ? AND status = 'ACTIVE' AND ${scoped.clause} LIMIT 1`,
    [parentId, ...scoped.values],
  );
  const parent = rows[0];
  if (!parent || !isParentRoleValid(targetRole, parent.role)) throw new Error("The selected parent is not valid for that role or branch.");
  return parent;
}

export async function createPlatformAccount(input: {
  scope: Scope;
  role: Role;
  fullName: string;
  email?: string;
  mobile?: string;
  countryCode: string;
  applicationUserId?: string;
  password: string;
  requestedParentId?: string;
  documents: PreparedDocument[];
}) {
  if (!rolesCreatableBy(input.scope.account.role).includes(input.role)) throw new Error("Your role cannot create that account type.");
  if (input.password.length < 8) throw new Error("Password must contain at least 8 characters.");
  const parent = await resolveParent(input.scope, input.role, input.requestedParentId);
  if (parent.country_code && parent.role !== "MASTER" && parent.country_code !== input.countryCode) {
    throw new Error("The account country must match its parent branch.");
  }
  const accountId = randomUUID();
  const roleCode = await generatedRoleCode(input.role);
  const passwordHash = await bcrypt.hash(input.password, 12);
  let publicId = 0;
  await withTransaction(async (connection) => {
    publicId = await generateManagementPublicId(connection);
    await connection.execute(
      `INSERT INTO platform_accounts
        (id, public_id, role, admin_kind, role_code, full_name, application_user_id, email, mobile,
         password_hash, status, parent_account_id, country_code, created_by)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
      [accountId, publicId, input.role, roleCode, input.fullName, input.applicationUserId || null, input.email || null, input.mobile || null, passwordHash, parent.id, input.countryCode, input.scope.account.id],
    );
    if (input.role === "COIN_SELLER") await connection.execute("INSERT INTO seller_profiles (account_id) VALUES (?)", [accountId]);
    for (const document of input.documents) {
      await connection.execute(
        `INSERT INTO private_documents
          (id, owner_type, owner_id, document_type, original_name, mime_type, byte_size,
           encrypted_data, encryption_iv, encryption_tag, uploaded_by)
         VALUES (?, 'PLATFORM_ACCOUNT', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [document.id, accountId, document.documentType, document.originalName, document.mimeType, document.byteSize, document.encryptedData, document.iv, document.tag, input.scope.account.id],
      );
    }
    await connection.execute(
      `INSERT INTO audit_logs
        (id, actor_account_id, actor_role, action, module, target_type, target_id, new_data, reason)
       VALUES (?, ?, ?, 'account.create', 'accounts', 'platform_account', ?, ?, 'Created through role-controlled account form')`,
      [randomUUID(), input.scope.account.id, input.scope.account.role, accountId, JSON.stringify({ role: input.role, publicId, parentId: parent.id, countryCode: input.countryCode })],
    );
  });
  return { accountId, publicId };
}

export async function reassignPlatformAccount(input: { scope: Scope; accountId: string; parentAccountId: string; reason: string }) {
  if (input.scope.account.role !== "MASTER") throw new Error("Only Master can reassign hierarchy branches.");
  if (input.accountId === input.parentAccountId || input.accountId === input.scope.account.id) throw new Error("Choose a valid child account and parent.");
  await withTransaction(async (connection) => {
    const [targets] = await connection.query<(RowDataPacket & { id: string; role: Role; parent_account_id: string | null; country_code: string | null })[]>(
      "SELECT id, role, parent_account_id, country_code FROM platform_accounts WHERE id = ? LIMIT 1 FOR UPDATE",
      [input.accountId],
    );
    const target = targets[0];
    if (!target || target.role === "MASTER") throw new Error("That hierarchy node cannot be reassigned.");
    const [parents] = await connection.query<(RowDataPacket & { id: string; role: Role; country_code: string | null })[]>(
      "SELECT id, role, country_code FROM platform_accounts WHERE id = ? AND status = 'ACTIVE' LIMIT 1 FOR UPDATE",
      [input.parentAccountId],
    );
    const parent = parents[0];
    if (!parent || !isParentRoleValid(target.role, parent.role)) throw new Error(`A ${roleLabel(target.role)} must be under ${validParentRoles(target.role).map(roleLabel).join(" or ")}.`);
    if (parent.country_code && target.country_code && parent.role !== "MASTER" && parent.country_code !== target.country_code) throw new Error("Move the account only to a parent in the same country.");
    const [cycles] = await connection.query<RowDataPacket[]>(
      `WITH RECURSIVE descendants AS (
         SELECT id FROM platform_accounts WHERE parent_account_id = ?
         UNION ALL
         SELECT child.id FROM platform_accounts child INNER JOIN descendants parent ON child.parent_account_id = parent.id
       ) SELECT id FROM descendants WHERE id = ? LIMIT 1`,
      [target.id, parent.id],
    );
    if (cycles[0]) throw new Error("That change would create a hierarchy cycle.");
    if (target.parent_account_id === parent.id) throw new Error("That account is already assigned to the selected parent.");
    await connection.execute("UPDATE platform_accounts SET parent_account_id = ? WHERE id = ?", [parent.id, target.id]);
    await connection.execute(
      `INSERT INTO audit_logs
        (id, actor_account_id, actor_role, action, module, target_type, target_id, previous_data, new_data, reason)
       VALUES (?, ?, ?, 'hierarchy.reassign', 'hierarchy', 'platform_account', ?, ?, ?, ?)`,
      [randomUUID(), input.scope.account.id, input.scope.account.role, target.id, JSON.stringify({ parentAccountId: target.parent_account_id }), JSON.stringify({ parentAccountId: parent.id }), input.reason],
    );
  });
}

async function manageableAccount(scope: Scope, accountId: string, lock = false) {
  const scoped = scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(scope, "id");
  const [rows] = await db().query<(RowDataPacket & { id: string; role: Role; status: string; full_name: string; parent_account_id: string | null })[]>(
    `SELECT id, role, status, full_name, parent_account_id FROM platform_accounts
     WHERE id = ? AND removed_at IS NULL AND ${scoped.clause} LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [accountId, ...scoped.values],
  );
  const target = rows[0];
  if (!target || target.id === scope.account.id || target.role === "MASTER" || !canManageRole(scope.account.role, target.role)) {
    throw new Error("That account cannot be managed in your branch.");
  }
  return target;
}

export async function updateAccountStatus(input: { scope: Scope; accountId: string; nextStatus: "ACTIVE" | "SUSPENDED" | "DISABLED"; reason: string }) {
  if (input.nextStatus === "DISABLED" && input.scope.account.role !== "MASTER") throw new Error("Only Master can permanently deactivate an account.");
  const target = await manageableAccount(input.scope, input.accountId);
  await withTransaction(async (connection) => {
    await connection.execute("UPDATE platform_accounts SET status = ?, removed_at = IF(? = 'DISABLED', CURRENT_TIMESTAMP(3), NULL), removed_by = IF(? = 'DISABLED', ?, NULL) WHERE id = ?", [input.nextStatus, input.nextStatus, input.nextStatus, input.scope.account.id, target.id]);
    await connection.execute("INSERT INTO account_status_history (id, account_id, from_status, to_status, reason, actor_account_id) VALUES (?, ?, ?, ?, ?, ?)", [randomUUID(), target.id, target.status, input.nextStatus, input.reason, input.scope.account.id]);
    await connection.execute(
      `INSERT INTO audit_logs
        (id, actor_account_id, actor_role, action, module, target_type, target_id, previous_data, new_data, reason)
       VALUES (?, ?, ?, 'account.status_change', 'accounts', 'platform_account', ?, ?, ?, ?)`,
      [randomUUID(), input.scope.account.id, input.scope.account.role, target.id, JSON.stringify({ status: target.status }), JSON.stringify({ status: input.nextStatus }), input.reason],
    );
  });
}

export async function updatePlatformAccount(input: { scope: Scope; accountId: string; fullName: string; email?: string; mobile?: string; countryCode: string; reason: string }) {
  const target = await manageableAccount(input.scope, input.accountId);
  const [countries] = await db().query<(RowDataPacket & { country_code: string | null })[]>("SELECT country_code FROM platform_accounts WHERE id = ?", [target.id]);
  if (countries[0]?.country_code && countries[0].country_code !== input.countryCode) throw new Error("Country cannot be changed through contact editing. Keep the assigned country and hierarchy consistent.");
  await withTransaction(async (connection) => {
    await connection.execute("UPDATE platform_accounts SET full_name = ?, email = ?, mobile = ?, country_code = ? WHERE id = ?", [input.fullName, input.email || null, input.mobile || null, input.countryCode, target.id]);
    await connection.execute(
      `INSERT INTO audit_logs
        (id, actor_account_id, actor_role, action, module, target_type, target_id, previous_data, new_data, reason)
       VALUES (?, ?, ?, 'account.edit', 'accounts', 'platform_account', ?, NULL, ?, ?)`,
      [randomUUID(), input.scope.account.id, input.scope.account.role, target.id, JSON.stringify({ fullName: input.fullName, email: input.email || null, mobile: input.mobile || null, countryCode: input.countryCode }), input.reason],
    );
  });
}

export async function listDirectChildRoles(scope: Scope, accountId: string) {
  if (!(await getPlatformAccountDetail(scope, accountId))) return [];
  const [rows] = await db().query<(RowDataPacket & { role: Role })[]>("SELECT DISTINCT role FROM platform_accounts WHERE parent_account_id = ? AND removed_at IS NULL", [accountId]);
  return rows.map((row) => row.role);
}

export async function changePlatformAccountRole(input: { scope: Scope; accountId: string; role: Role; parentAccountId: string; childParentId?: string; reason: string }) {
  if (!rolesAssignableBy(input.scope.account.role).includes(input.role)) throw new Error("That role cannot be assigned by your account.");
  if (input.accountId === input.scope.account.id || input.accountId === input.parentAccountId) throw new Error("An account cannot change its own role or be its own parent.");
  if (input.reason.trim().length < 5) throw new Error("Provide a clear reason for the role change.");
  const scoped = scopeWhere(input.scope, "id");
  await withTransaction(async (connection) => {
    const [targets] = await connection.query<(RowDataPacket & { id: string; role: Role; parent_account_id: string | null; country_code: string | null })[]>(`SELECT id, role, parent_account_id, country_code FROM platform_accounts WHERE id = ? AND removed_at IS NULL AND ${scoped.clause} LIMIT 1 FOR UPDATE`, [input.accountId, ...scoped.values]);
    const target = targets[0];
    if (!target || !canManageRole(input.scope.account.role, target.role)) throw new Error("Account was not found in your permitted branch.");
    const [parents] = await connection.query<(RowDataPacket & { id: string; role: Role; country_code: string | null })[]>(`SELECT id, role, country_code FROM platform_accounts WHERE id = ? AND status = 'ACTIVE' AND ${scoped.clause} LIMIT 1 FOR UPDATE`, [input.parentAccountId, ...scoped.values]);
    const parent = parents[0];
    if (!parent || !isParentRoleValid(input.role, parent.role)) throw new Error(`Choose a valid ${validParentRoles(input.role).map(roleLabel).join(" or ")} parent.`);
    if (parent.role !== "MASTER" && parent.country_code && target.country_code && parent.country_code !== target.country_code) throw new Error("The account and parent must be in the same country.");
    const [cycles] = await connection.query<RowDataPacket[]>(
      `WITH RECURSIVE descendants AS (
         SELECT id FROM platform_accounts WHERE parent_account_id = ?
         UNION ALL SELECT child.id FROM platform_accounts child INNER JOIN descendants parent ON child.parent_account_id = parent.id
       ) SELECT id FROM descendants WHERE id = ? LIMIT 1`,
      [target.id, parent.id],
    );
    if (cycles[0]) throw new Error("That role change would create a hierarchy cycle.");
    const [children] = await connection.query<(RowDataPacket & { id: string; role: Role; country_code: string | null })[]>(
      "SELECT id, role, country_code FROM platform_accounts WHERE parent_account_id = ? AND removed_at IS NULL FOR UPDATE",
      [target.id],
    );
    const invalidChildren = children.filter((child) => !isParentRoleValid(child.role, input.role));
    if (invalidChildren.length) {
      if (!input.childParentId || input.childParentId === target.id) throw new Error("Choose where to move the existing downstream accounts for this role change.");
      const [destinations] = await connection.query<(RowDataPacket & { id: string; role: Role; country_code: string | null })[]>(`SELECT id, role, country_code FROM platform_accounts WHERE id = ? AND status = 'ACTIVE' AND ${scoped.clause} LIMIT 1 FOR UPDATE`, [input.childParentId, ...scoped.values]);
      const destination = destinations[0];
      if (!destination || invalidChildren.some((child) => !isParentRoleValid(child.role, destination.role) || (child.country_code && destination.country_code && child.country_code !== destination.country_code))) throw new Error("Choose a compatible downstream parent in the same country and branch.");
      const [descendants] = await connection.query<(RowDataPacket & { id: string })[]>(`WITH RECURSIVE subtree AS (SELECT id FROM platform_accounts WHERE parent_account_id = ? UNION ALL SELECT a.id FROM platform_accounts a INNER JOIN subtree s ON a.parent_account_id = s.id) SELECT id FROM subtree WHERE id = ? LIMIT 1`, [target.id, destination.id]);
      if (descendants.length) throw new Error("The downstream destination must be outside the account being changed.");
      for (const child of invalidChildren) {
        await connection.execute("UPDATE platform_accounts SET parent_account_id = ? WHERE id = ?", [destination.id, child.id]);
        await connection.execute("INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, previous_data, new_data, reason) VALUES (?, ?, ?, 'hierarchy.role_change_reassign', 'hierarchy', 'platform_account', ?, ?, ?, ?)", [randomUUID(), input.scope.account.id, input.scope.account.role, child.id, JSON.stringify({ parentAccountId: target.id }), JSON.stringify({ parentAccountId: destination.id }), input.reason]);
      }
    }
    if (target.role === "AGENCY" && input.role !== "AGENCY") {
      const [hosts] = await connection.query<RowDataPacket[]>("SELECT id FROM host_profiles WHERE agency_account_id = ? LIMIT 1", [target.id]);
      if (hosts[0]) throw new Error("Move this Agency's hosts before changing its role.");
    }
    await connection.execute("UPDATE platform_accounts SET role = ?, admin_kind = NULL, parent_account_id = ? WHERE id = ?", [input.role, parent.id, target.id]);
    if (input.role === "COIN_SELLER") await connection.execute("INSERT IGNORE INTO seller_profiles (account_id) VALUES (?)", [target.id]);
    await connection.execute(
      `INSERT INTO audit_logs
        (id, actor_account_id, actor_role, action, module, target_type, target_id, previous_data, new_data, reason)
       VALUES (?, ?, ?, 'account.role_change', 'accounts', 'platform_account', ?, ?, ?, ?)`,
      [randomUUID(), input.scope.account.id, input.scope.account.role, target.id, JSON.stringify({ role: target.role, parentAccountId: target.parent_account_id }), JSON.stringify({ role: input.role, parentAccountId: parent.id }), input.reason],
    );
  });
}

export async function permanentlyRemovePlatformAccount(input: { scope: Scope; accountId: string; reason: string; confirmed: boolean }) {
  if (input.scope.account.role !== "MASTER" || !input.confirmed) throw new Error("Master confirmation is required for permanent removal.");
  const [dependencies] = await db().query<(RowDataPacket & { child_count: number; host_count: number })[]>(
    `SELECT
       (SELECT COUNT(*) FROM platform_accounts WHERE parent_account_id = ? AND status != 'DISABLED') child_count,
       (SELECT COUNT(*) FROM host_profiles WHERE agency_account_id = ?) host_count`,
    [input.accountId, input.accountId],
  );
  if (Number(dependencies[0]?.child_count ?? 0) || Number(dependencies[0]?.host_count ?? 0)) {
    throw new Error("Reassign all downstream accounts and hosts before permanently removing this account.");
  }
  await updateAccountStatus({ scope: input.scope, accountId: input.accountId, nextStatus: "DISABLED", reason: input.reason });
}

export async function resetAccountPassword(input: { scope: Scope; accountId: string; password: string; reason: string }) {
  const target = await manageableAccount(input.scope, input.accountId);
  const hash = await bcrypt.hash(input.password, 12);
  await withTransaction(async (connection) => {
    await connection.execute("UPDATE platform_accounts SET password_hash = ? WHERE id = ?", [hash, target.id]);
    await connection.execute("INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, reason) VALUES (?, ?, ?, 'account.password_reset', 'accounts', 'platform_account', ?, ?)", [randomUUID(), input.scope.account.id, input.scope.account.role, target.id, input.reason]);
  });
}
