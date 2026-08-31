import "server-only";

import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { generateManagementPublicId } from "@/lib/db/public-id";
import { generatedRoleCode, scopeWhere } from "@/lib/db/repositories/accounts";
import type { Scope } from "@/types/platform";

export type AgencyReviewApplication = {
  id: string;
  type: "JOIN" | "CREATE";
  userName: string;
  userPublicId: string;
  agencyName: string;
  agencyPublicId: string | null;
  ownerName: string | null;
  countryCode: string | null;
  whatsapp: string | null;
  parentName: string | null;
  parentPublicId: string | null;
  parentRole: string | null;
  panMasked: string | null;
  aadhaarMasked: string | null;
  hasDocument: boolean;
  documentCount?: number;
  status: string;
  createdAt: string;
};

export async function listAgencyApplications(scope: Scope): Promise<AgencyReviewApplication[]> {
  const agencyScope = scopeWhere(scope, "application.agency_account_id");
  try {
    const [joins] = await db().query<(RowDataPacket & { id: string; full_name: string; public_id: number; agency_name: string; agency_public_id: number; status: string; created_at: string })[]>(
      `SELECT application.id, user.full_name, user.public_id, agency.full_name agency_name,
              agency.public_id agency_public_id, application.status, application.created_at
       FROM agency_membership_applications application
       INNER JOIN application_users user ON user.id = application.application_user_id
       INNER JOIN platform_accounts agency ON agency.id = application.agency_account_id
       WHERE ${agencyScope.clause}
       ORDER BY FIELD(application.status, 'PENDING','APPROVED','REJECTED','SUSPENDED','REMOVED'), application.created_at DESC LIMIT 50`,
      agencyScope.values,
    );
    let creations: (RowDataPacket & { id: string; full_name: string; public_id: number; agency_name: string; owner_name: string | null; country_code: string; business_whatsapp_e164: string; parent_name: string | null; parent_public_id: number | null; parent_role: string | null; pan_last4: string | null; aadhaar_last4: string | null; document_byte_size: number | null; status: string; created_at: string })[] = [];
    if (["MASTER", "COUNTRY_MANAGER", "SUPER_ADMIN", "ADMIN", "BD"].includes(scope.account.role)) {
      const creationScope = scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(scope, "application.parent_account_id");
      const [rows] = await db().query<typeof creations>(
        `SELECT application.id, user.full_name, user.public_id, application.agency_name,
                application.owner_name, application.country_code, application.business_whatsapp_e164,
                parent.full_name parent_name, parent.public_id parent_public_id, parent.role parent_role,
                application.pan_last4, application.aadhaar_last4, application.document_byte_size,
                application.status, application.created_at,
                (SELECT COUNT(*) FROM agency_application_documents document WHERE document.application_id = application.id) document_count
         FROM agency_creation_applications application
         INNER JOIN application_users user ON user.id = application.application_user_id
         LEFT JOIN platform_accounts parent ON parent.id = application.parent_account_id
         WHERE ${creationScope.clause}
         ORDER BY FIELD(application.status, 'PENDING','APPROVED','REJECTED','SUSPENDED'), application.created_at DESC LIMIT 50`,
        creationScope.values,
      );
      creations = rows;
    }
    return [
      ...joins.map((row) => ({ id: row.id, type: "JOIN" as const, userName: row.full_name, userPublicId: String(row.public_id), agencyName: row.agency_name, agencyPublicId: String(row.agency_public_id), ownerName: null, countryCode: null, whatsapp: null, parentName: null, parentPublicId: null, parentRole: null, panMasked: null, aadhaarMasked: null, hasDocument: false, status: row.status, createdAt: row.created_at })),
      ...creations.map((row) => ({ id: row.id, type: "CREATE" as const, userName: row.full_name, userPublicId: String(row.public_id), agencyName: row.agency_name, agencyPublicId: null, ownerName: row.owner_name, countryCode: row.country_code, whatsapp: row.business_whatsapp_e164, parentName: row.parent_name, parentPublicId: row.parent_public_id == null ? null : String(row.parent_public_id), parentRole: row.parent_role, panMasked: row.pan_last4 ? `*****${row.pan_last4}*` : null, aadhaarMasked: row.aadhaar_last4 ? `XXXX XXXX ${row.aadhaar_last4}` : null, hasDocument: Number(row.document_byte_size ?? 0) > 0, documentCount: Number(row.document_count ?? 0), status: row.status, createdAt: row.created_at })),
    ].sort((left, right) => Number(left.status !== "PENDING") - Number(right.status !== "PENDING") || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  } catch (error) {
    if ((error as { code?: string }).code === "ER_NO_SUCH_TABLE") return [];
    throw error;
  }
}

export async function reviewAgencyJoin(input: { scope: Scope; applicationId: string; decision: "APPROVED" | "REJECTED"; reason: string }) {
  await withTransaction(async (connection) => {
    const scoped = scopeWhere(input.scope, "application.agency_account_id");
    const [rows] = await connection.query<(RowDataPacket & { id: string; application_user_id: string; agency_account_id: string; status: string; agency_name: string })[]>(
      `SELECT application.id, application.application_user_id, application.agency_account_id, application.status,
              agency.full_name agency_name
       FROM agency_membership_applications application
       INNER JOIN platform_accounts agency ON agency.id = application.agency_account_id
       WHERE application.id = ? AND ${scoped.clause} LIMIT 1 FOR UPDATE`,
      [input.applicationId, ...scoped.values],
    );
    const application = rows[0];
    if (!application || application.status !== "PENDING") throw new Error("That pending join application is not available in your scope.");
    if (input.decision === "APPROVED") {
      const [users] = await connection.query<(RowDataPacket & { agency_account_id: string | null })[]>("SELECT agency_account_id FROM application_users WHERE id = ? LIMIT 1 FOR UPDATE", [application.application_user_id]);
      if (users[0]?.agency_account_id) throw new Error("The user is already linked to an Agency.");
      const [pendingCreations] = await connection.query<RowDataPacket[]>("SELECT id FROM agency_creation_applications WHERE application_user_id = ? AND status = 'PENDING' LIMIT 1", [application.application_user_id]);
      if (pendingCreations.length) throw new Error("Resolve the user's pending Agency creation application first.");
      await connection.execute("UPDATE application_users SET agency_account_id = ? WHERE id = ?", [application.agency_account_id, application.application_user_id]);
      await connection.execute("UPDATE host_profiles SET agency_account_id = ? WHERE application_user_id = ?", [application.agency_account_id, application.application_user_id]);
    }
    await connection.execute("UPDATE agency_membership_applications SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP(3), review_reason = ? WHERE id = ?", [input.decision, input.scope.account.id, input.reason, application.id]);
    await connection.execute("INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'AGENCY', ?, ?, 'agency')", [randomUUID(), application.application_user_id, `Agency application ${input.decision.toLowerCase()}`, input.decision === "APPROVED" ? `You are now a member of ${application.agency_name}.` : input.reason]);
    await connection.execute("INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, new_data, reason) VALUES (?, ?, ?, 'agency.join_review', 'agencies', 'agency_membership_application', ?, ?, ?)", [randomUUID(), input.scope.account.id, input.scope.account.role, application.id, JSON.stringify({ status: input.decision, agencyAccountId: application.agency_account_id }), input.reason]);
  });
}

export async function reviewAgencyCreation(input: { scope: Scope; applicationId: string; decision: "APPROVED" | "REJECTED"; reason: string }) {
  if (input.scope.account.role !== "MASTER") throw new Error("Only Master can review Agency creation applications.");
  const passwordHash = await bcrypt.hash(randomUUID(), 12);
  await withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { id: string; application_user_id: string; agency_name: string; country_code: string; business_whatsapp_e164: string; parent_account_id: string | null; status: string; document_original_name: string | null; document_mime_type: string | null; document_byte_size: number | null; document_encrypted_data: Buffer | null; document_encryption_iv: Buffer | null; document_encryption_tag: Buffer | null })[]>(
      `SELECT id, application_user_id, agency_name, country_code, business_whatsapp_e164, parent_account_id, status,
              document_original_name, document_mime_type, document_byte_size, document_encrypted_data,
              document_encryption_iv, document_encryption_tag
       FROM agency_creation_applications WHERE id = ? LIMIT 1 FOR UPDATE`, [input.applicationId],
    );
    const application = rows[0];
    if (!application || application.status !== "PENDING") throw new Error("That creation application is no longer pending.");
    if (!application.parent_account_id) throw new Error("This legacy application has no verified Admin/BD parent and cannot be approved. Ask the applicant to submit the updated form.");
    if (!input.scope.isGlobal && !input.scope.accountIds.includes(application.parent_account_id)) throw new Error("This application belongs to a different hierarchy branch.");
    let agencyAccountId: string | null = null;
    if (input.decision === "APPROVED") {
      const parentId = application.parent_account_id;
      const [parents] = await connection.query<RowDataPacket[]>("SELECT id FROM platform_accounts WHERE id = ? AND role IN ('ADMIN','BD') AND status = 'ACTIVE' LIMIT 1", [parentId]);
      if (!parents[0]) throw new Error("The verified Admin/BD parent is no longer active.");
      const [users] = await connection.query<(RowDataPacket & { agency_account_id: string | null })[]>("SELECT agency_account_id FROM application_users WHERE id = ? LIMIT 1 FOR UPDATE", [application.application_user_id]);
      if (users[0]?.agency_account_id) throw new Error("The applicant is already linked to an Agency.");
      const [openMemberships] = await connection.query<RowDataPacket[]>("SELECT id FROM agency_membership_applications WHERE application_user_id = ? AND status IN ('PENDING','APPROVED') LIMIT 1", [application.application_user_id]);
      if (openMemberships.length) throw new Error("Resolve the applicant's existing Agency membership request first.");
      agencyAccountId = randomUUID();
      const publicId = await generateManagementPublicId(connection);
      const roleCode = await generatedRoleCode("AGENCY");
      await connection.execute(
        `INSERT INTO platform_accounts (id, public_id, role, role_code, full_name, application_user_id, mobile, password_hash, status, parent_account_id, country_code, created_by)
         VALUES (?, ?, 'AGENCY', ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
        [agencyAccountId, publicId, roleCode, application.agency_name, application.application_user_id, application.business_whatsapp_e164, passwordHash, parentId, application.country_code, input.scope.account.id],
      );
      await connection.execute("UPDATE application_users SET agency_account_id = ? WHERE id = ?", [agencyAccountId, application.application_user_id]);
      await connection.execute("UPDATE host_profiles SET agency_account_id = ? WHERE application_user_id = ?", [agencyAccountId, application.application_user_id]);
      const [extraDocuments] = await connection.query<RowDataPacket[]>("SELECT * FROM agency_application_documents WHERE application_id = ? AND slot > 1 ORDER BY slot", [application.id]);
      for (const document of extraDocuments) {
        await connection.execute("INSERT INTO private_documents (id, owner_type, owner_id, document_type, original_name, mime_type, byte_size, encrypted_data, encryption_iv, encryption_tag, uploaded_by) VALUES (?, 'PLATFORM_ACCOUNT', ?, 'AGENCY_KYC_PROOF', ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), agencyAccountId, document.original_name, document.mime_type, document.byte_size, document.encrypted_data, document.encryption_iv, document.encryption_tag, input.scope.account.id]);
      }
      if (application.document_encrypted_data && application.document_encryption_iv && application.document_encryption_tag && application.document_original_name && application.document_mime_type && application.document_byte_size) {
        await connection.execute(
          `INSERT INTO private_documents (id, owner_type, owner_id, document_type, original_name, mime_type, byte_size, encrypted_data, encryption_iv, encryption_tag, uploaded_by)
           VALUES (?, 'PLATFORM_ACCOUNT', ?, 'AGENCY_KYC_PROOF', ?, ?, ?, ?, ?, ?, ?)`,
          [randomUUID(), agencyAccountId, application.document_original_name, application.document_mime_type, application.document_byte_size, application.document_encrypted_data, application.document_encryption_iv, application.document_encryption_tag, input.scope.account.id],
        );
      }
    }
    await connection.execute("UPDATE agency_creation_applications SET status = ?, approved_agency_account_id = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP(3), review_reason = ? WHERE id = ?", [input.decision, agencyAccountId, input.scope.account.id, input.reason, application.id]);
    await connection.execute("INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'AGENCY', ?, ?, 'agency')", [randomUUID(), application.application_user_id, `Agency creation ${input.decision.toLowerCase()}`, input.decision === "APPROVED" ? `${application.agency_name} is ready.` : input.reason]);
    await connection.execute("INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, new_data, reason) VALUES (?, ?, ?, 'agency.creation_review', 'agencies', 'agency_creation_application', ?, ?, ?)", [randomUUID(), input.scope.account.id, input.scope.account.role, application.id, JSON.stringify({ status: input.decision, agencyAccountId, parentAccountId: application.parent_account_id }), input.reason]);
  });
}
