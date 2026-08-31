import "server-only";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { scopeWhere } from "@/lib/db/repositories/accounts";
import type { PreparedDocument } from "@/lib/security/documents";
import type { Scope } from "@/types/platform";

export async function createHostApplication(input: { scope: Scope; applicationUserId: string; legalName: string; countryCode: string; agencyAccountId?: string; governmentIdType: string; governmentIdLast4: string; documents: PreparedDocument[] }) {
  const hostId = randomUUID();
  const userScope = scopeWhere(input.scope, "u.agency_account_id");
  await withTransaction(async (connection) => {
    const [users] = await connection.query<(RowDataPacket & { id: string; full_name: string; agency_account_id: string | null })[]>(
      `SELECT u.id, u.full_name, u.agency_account_id FROM application_users u WHERE u.id = ? AND ${userScope.clause} LIMIT 1 FOR UPDATE`, [input.applicationUserId, ...userScope.values],
    );
    if (!users[0]) throw new Error("The application user was not found in your permitted hierarchy.");
    const agencyAccountId = input.agencyAccountId || users[0].agency_account_id;
    if (agencyAccountId) {
      const agencyScope = input.scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(input.scope, "id");
      const [agencies] = await connection.query<RowDataPacket[]>(`SELECT id FROM platform_accounts WHERE id = ? AND role = 'AGENCY' AND ${agencyScope.clause} LIMIT 1`, [agencyAccountId, ...agencyScope.values]);
      if (!agencies[0]) throw new Error("The selected agency is outside your hierarchy.");
    }
    await connection.execute(
      `INSERT INTO host_profiles (id, application_user_id, legal_name, agency_account_id, country_code, status, verification_status, government_id_type, government_id_last4)
       VALUES (?, ?, ?, ?, ?, 'PENDING', 'PENDING', ?, ?)`,
      [hostId, input.applicationUserId, input.legalName, agencyAccountId || null, input.countryCode, input.governmentIdType, input.governmentIdLast4],
    );
    for (const document of input.documents) {
      await connection.execute(
        `INSERT INTO private_documents (id, owner_type, owner_id, document_type, original_name, mime_type, byte_size, encrypted_data, encryption_iv, encryption_tag, uploaded_by)
         VALUES (?, 'HOST_APPLICATION', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [document.id, hostId, document.documentType, document.originalName, document.mimeType, document.byteSize, document.encryptedData, document.iv, document.tag, input.scope.account.id],
      );
    }
    await connection.execute(
      `INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, new_data, reason)
       VALUES (?, ?, ?, 'host.application_create', 'hosts', 'host_application', ?, ?, 'Application created for review')`,
      [randomUUID(), input.scope.account.id, input.scope.account.role, hostId, JSON.stringify({ applicationUserId: input.applicationUserId, agencyAccountId: agencyAccountId || null })],
    );
  });
  return hostId;
}

export async function uploadHostDocument(input: { scope: Scope; hostId: string; document: PreparedDocument }) {
  const hostScope = scopeWhere(input.scope, "h.agency_account_id");
  const [hosts] = await db().query<RowDataPacket[]>(`SELECT h.id FROM host_profiles h WHERE h.id = ? AND ${hostScope.clause} LIMIT 1`, [input.hostId, ...hostScope.values]);
  if (!hosts[0]) throw new Error("Host application was not found in your scope.");
  await db().execute(
    `INSERT INTO private_documents (id, owner_type, owner_id, document_type, original_name, mime_type, byte_size, encrypted_data, encryption_iv, encryption_tag, uploaded_by)
     VALUES (?, 'HOST_APPLICATION', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.document.id, input.hostId, input.document.documentType, input.document.originalName, input.document.mimeType, input.document.byteSize, input.document.encryptedData, input.document.iv, input.document.tag, input.scope.account.id],
  );
}

export async function reviewHostApplication(input: { scope: Scope; hostId: string; decision: "APPROVED" | "REJECTED"; agencyAccountId?: string; reason: string }) {
  const hostScope = scopeWhere(input.scope, "h.agency_account_id");
  await withTransaction(async (connection) => {
    const [hosts] = await connection.query<(RowDataPacket & { id: string; application_user_id: string; status: string; agency_account_id: string | null })[]>(
      `SELECT h.id, h.application_user_id, h.status, h.agency_account_id FROM host_profiles h WHERE h.id = ? AND ${hostScope.clause} LIMIT 1 FOR UPDATE`,
      [input.hostId, ...hostScope.values],
    );
    const host = hosts[0];
    if (!host) throw new Error("Host application was not found in your scope.");
    if (!['PENDING', 'REJECTED'].includes(host.status)) throw new Error("This application is no longer waiting for a review decision.");
    const agencyId = input.agencyAccountId || host.agency_account_id;
    if (input.decision === "APPROVED" && !agencyId) throw new Error("Assign an agency before approving the host.");
    if (agencyId) {
      const agencyScope = input.scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(input.scope, "id");
      const [agencies] = await connection.query<RowDataPacket[]>(`SELECT id FROM platform_accounts WHERE id = ? AND role = 'AGENCY' AND status = 'ACTIVE' AND ${agencyScope.clause} LIMIT 1`, [agencyId, ...agencyScope.values]);
      if (!agencies[0]) throw new Error("The selected agency is outside your hierarchy.");
    }
    await connection.execute(
      `UPDATE host_profiles SET status = ?, verification_status = ?, agency_account_id = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP(3), review_reason = ? WHERE id = ?`,
      [input.decision, input.decision === "APPROVED" ? "VERIFIED" : "REJECTED", agencyId || null, input.scope.account.id, input.reason, host.id],
    );
    await connection.execute("UPDATE application_users SET is_host = ?, agency_account_id = COALESCE(?, agency_account_id) WHERE id = ?", [input.decision === "APPROVED", agencyId || null, host.application_user_id]);
    await connection.execute(
      `INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, previous_data, new_data, reason)
       VALUES (?, ?, ?, 'host.review', 'hosts', 'host_application', ?, ?, ?, ?)`,
      [randomUUID(), input.scope.account.id, input.scope.account.role, host.id, JSON.stringify({ status: host.status }), JSON.stringify({ status: input.decision, agencyId }), input.reason],
    );
  });
}

export async function updateHostStatus(input: { scope: Scope; hostId: string; status: "ACTIVE" | "INACTIVE" | "SUSPENDED"; reason: string }) {
  if (input.reason.trim().length < 5 || input.reason.trim().length > 500) throw new Error("Provide a reason of 5 to 500 characters for the host status change.");
  const hostScope = scopeWhere(input.scope, "h.agency_account_id");
  await withTransaction(async (connection) => {
    const [hosts] = await connection.query<(RowDataPacket & { id: string; application_user_id: string; status: string })[]>(
      `SELECT h.id, h.application_user_id, h.status FROM host_profiles h WHERE h.id = ? AND ${hostScope.clause} LIMIT 1 FOR UPDATE`,
      [input.hostId, ...hostScope.values],
    );
    const host = hosts[0];
    if (!host) throw new Error("Only hosts in your hierarchy can change operational status.");
    if (host.status === input.status) throw new Error("Choose a different host status.");
    await connection.execute("UPDATE host_profiles SET status = ? WHERE id = ?", [input.status, host.id]);
    if (input.status !== "ACTIVE") {
      await connection.execute("UPDATE live_rooms SET status = 'ENDED', ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3)) WHERE host_application_user_id = ? AND status IN ('ACTIVE','LOCKED')", [host.application_user_id]);
    }
    await connection.execute(
      `INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, previous_data, new_data, reason)
       VALUES (?, ?, ?, 'host.status_change', 'hosts', 'host', ?, ?, ?, ?)`,
      [randomUUID(), input.scope.account.id, input.scope.account.role, host.id, JSON.stringify({ status: host.status }), JSON.stringify({ status: input.status }), input.reason],
    );
  });
}

export async function getHostDetail(scope: Scope, hostId: string) {
  const hostScope = scopeWhere(scope, "h.agency_account_id");
  const [rows] = await db().query<(RowDataPacket & { id: string; application_user_id: string; legal_name: string | null; full_name: string; external_user_id: string; country_code: string | null; status: string; verification_status: string; government_id_type: string | null; government_id_last4: string | null; agency_account_id: string | null; agency_name: string | null; applied_at: string; reviewed_at: string | null; review_reason: string | null })[]>(
    `SELECT h.id, h.application_user_id, h.legal_name, u.full_name, u.external_user_id, h.country_code, h.status, h.verification_status,
            h.government_id_type, h.government_id_last4, h.agency_account_id, a.full_name agency_name, h.applied_at, h.reviewed_at, h.review_reason
     FROM host_profiles h INNER JOIN application_users u ON u.id = h.application_user_id
     LEFT JOIN platform_accounts a ON a.id = h.agency_account_id
     WHERE h.id = ? AND ${hostScope.clause} LIMIT 1`, [hostId, ...hostScope.values],
  );
  return rows[0] ? { id: rows[0].id, applicationUserId: rows[0].application_user_id, legalName: rows[0].legal_name ?? rows[0].full_name, displayName: rows[0].full_name, externalUserId: rows[0].external_user_id, country: rows[0].country_code, status: rows[0].status, verification: rows[0].verification_status, governmentIdType: rows[0].government_id_type, governmentIdLast4: rows[0].government_id_last4, agencyId: rows[0].agency_account_id, agencyName: rows[0].agency_name, appliedAt: rows[0].applied_at, reviewedAt: rows[0].reviewed_at, reviewReason: rows[0].review_reason } : null;
}

export async function listHostDocuments(scope: Scope, hostId: string) {
  const host = await getHostDetail(scope, hostId);
  if (!host) return [];
  const [rows] = await db().query<(RowDataPacket & { id: string; document_type: string; original_name: string; mime_type: string; byte_size: number; verification_status: string; created_at: string })[]>(
    `SELECT id, document_type, original_name, mime_type, byte_size, verification_status, created_at
     FROM private_documents WHERE owner_type = 'HOST_APPLICATION' AND owner_id = ? ORDER BY created_at`, [hostId],
  );
  return rows.map((row) => ({ id: row.id, type: row.document_type, name: row.original_name, mimeType: row.mime_type, size: Number(row.byte_size), status: row.verification_status, createdAt: row.created_at }));
}
