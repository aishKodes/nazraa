import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { encryptPrivateText } from "@/lib/security/documents";

type PolicyConfig = {
  termsVersion: string;
  communityGuidelinesVersion: string;
  requiresReacceptance: boolean;
  [key: string]: unknown;
};

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function policyConfig(connection?: PoolConnection): Promise<PolicyConfig> {
  const executor = connection ?? db();
  const [rows] = await executor.query<(RowDataPacket & { setting_value: unknown })[]>(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.policy_config' LIMIT 1",
  );
  const value = objectValue(rows[0]?.setting_value);
  return {
    ...value,
    termsVersion: String(value.termsVersion ?? "2026-09-06"),
    communityGuidelinesVersion: String(value.communityGuidelinesVersion ?? "2026-09-06"),
    requiresReacceptance: value.requiresReacceptance !== false,
  };
}

export async function publicPolicyConfig() {
  return policyConfig();
}

export async function currentPolicyAcceptance(identity: MobileIdentity) {
  const config = await policyConfig();
  const [rows] = await db().query<(RowDataPacket & { policy_key: string; policy_version: string })[]>(
    `SELECT policy_key, policy_version FROM policy_acceptances
     WHERE application_user_id = ? AND (
       (policy_key = 'terms' AND policy_version = ?) OR
       (policy_key = 'community-guidelines' AND policy_version = ?)
     )`,
    [identity.userId, config.termsVersion, config.communityGuidelinesVersion],
  );
  const accepted = new Set(rows.map((row) => `${row.policy_key}:${row.policy_version}`));
  const termsAccepted = accepted.has(`terms:${config.termsVersion}`);
  const guidelinesAccepted = accepted.has(`community-guidelines:${config.communityGuidelinesVersion}`);
  return { ...config, termsAccepted, guidelinesAccepted, required: config.requiresReacceptance && (!termsAccepted || !guidelinesAccepted) };
}

export async function acceptCurrentPolicies(identity: MobileIdentity, input: {
  termsVersion: string;
  communityGuidelinesVersion: string;
  source?: "ONBOARDING" | "IN_APP" | "PLAY_REVIEWER";
}) {
  return withTransaction(async (connection) => {
    const config = await policyConfig(connection);
    if (input.termsVersion !== config.termsVersion || input.communityGuidelinesVersion !== config.communityGuidelinesVersion) {
      throw new Error("The policies were updated. Please review the current versions and accept again.");
    }
    await connection.execute(
      `INSERT IGNORE INTO policy_acceptances
        (application_user_id, policy_key, policy_version, source)
       VALUES (?, 'terms', ?, ?), (?, 'community-guidelines', ?, ?)`,
      [identity.userId, config.termsVersion, input.source ?? "IN_APP",
        identity.userId, config.communityGuidelinesVersion, input.source ?? "IN_APP"],
    );
    return { accepted: true, termsVersion: config.termsVersion, communityGuidelinesVersion: config.communityGuidelinesVersion };
  });
}

export async function assertCurrentPoliciesAccepted(identity: MobileIdentity) {
  const state = await currentPolicyAcceptance(identity);
  if (state.required) {
    throw Object.assign(
      new Error("Review and accept the current Terms and Community Guidelines to continue."),
      { code: "POLICY_ACCEPTANCE_REQUIRED" },
    );
  }
}

export async function submitSafetyReport(identity: MobileIdentity, input: {
  clientReportId: string;
  reportType: "PROFILE" | "USER" | "HOST" | "ROOM" | "CONTENT" | "DIRECT_MESSAGE" | "CHILD_SAFETY" | "COPYRIGHT";
  reasonCode: string;
  reasonDetail?: string;
  targetPublicId?: string;
  roomCode?: string;
  contentId?: string;
  messageId?: string;
  evidenceMetadata?: Record<string, unknown>;
}) {
  return withTransaction(async (connection) => {
    const [existing] = await connection.query<(RowDataPacket & { id: string; status: string })[]>(
      "SELECT id, status FROM safety_reports WHERE reporter_application_user_id = ? AND client_report_id = ? LIMIT 1 FOR UPDATE",
      [identity.userId, input.clientReportId],
    );
    if (existing[0]) return { id: existing[0].id, status: String(existing[0].status).toLowerCase(), alreadySubmitted: true };
    let targetUserId: string | null = null;
    let roomId: string | null = null;
    if (input.targetPublicId) {
      const [targets] = await connection.query<(RowDataPacket & { id: string })[]>(
        "SELECT id FROM application_users WHERE public_id = ? LIMIT 1",
        [input.targetPublicId],
      );
      targetUserId = targets[0]?.id ?? null;
    }
    if (input.roomCode) {
      const [rooms] = await connection.query<(RowDataPacket & { id: string; host_application_user_id: string })[]>(
        "SELECT id, host_application_user_id FROM live_rooms WHERE room_code = ? LIMIT 1",
        [input.roomCode],
      );
      roomId = rooms[0]?.id ?? null;
      targetUserId ??= rooms[0]?.host_application_user_id ?? null;
    }
    const severity = input.reportType === "CHILD_SAFETY" || input.reasonCode === "child_safety"
      ? "CRITICAL"
      : ["sexual_content", "threats", "violence"].includes(input.reasonCode) ? "HIGH" : "NORMAL";
    const id = randomUUID();
    await connection.execute(
      `INSERT INTO safety_reports
        (id, client_report_id, reporter_application_user_id, report_type, reason_code,
         reason_detail, target_application_user_id, room_id, content_id, message_id,
         evidence_metadata, severity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.clientReportId, identity.userId, input.reportType, input.reasonCode,
        input.reasonDetail?.trim() || null, targetUserId, roomId, input.contentId ?? null,
        input.messageId ?? null, JSON.stringify(input.evidenceMetadata ?? {}), severity],
    );
    return { id, status: "new", alreadySubmitted: false };
  });
}

function requestCode(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

export async function deleteAuthenticatedAccount(identity: MobileIdentity) {
  return withTransaction(async (connection) => {
    const [users] = await connection.query<(RowDataPacket & { external_user_id: string; public_id: number; deletion_requested_at: Date | null })[]>(
      "SELECT external_user_id, public_id, deletion_requested_at FROM application_users WHERE id = ? LIMIT 1 FOR UPDATE",
      [identity.userId],
    );
    const user = users[0];
    if (!user) throw new Error("Your Nazraa account was not found.");
    if (user.deletion_requested_at) {
      return { completed: true, message: "Your account deletion request has already been completed." };
    }
    const deletionId = randomUUID();
    const code = requestCode("DEL");
    const retention = {
      retained: ["wallet and transaction audit", "gift and purchase audit", "moderation/security audit", "legally required financial records"],
      removed: ["public profile", "profile image", "public discovery content", "sign-in identifiers", "verification selfie"],
    };
    await connection.execute(
      `INSERT INTO account_deletion_requests
        (id, request_code, application_user_id, source, status, retention_summary)
       VALUES (?, ?, ?, 'IN_APP', 'PROCESSING', ?)`,
      [deletionId, code, identity.userId, JSON.stringify(retention)],
    );
    const [verificationRows] = await connection.query<(RowDataPacket & { id: string; selfie_document_id: string | null })[]>(
      "SELECT id, selfie_document_id FROM face_verification_requests WHERE application_user_id = ? FOR UPDATE",
      [identity.userId],
    );
    const documentIds = verificationRows.map((row) => row.selfie_document_id).filter((id): id is string => Boolean(id));
    if (documentIds.length) {
      await connection.execute("UPDATE face_verification_requests SET selfie_document_id = NULL WHERE application_user_id = ?", [identity.userId]);
      await connection.query("DELETE FROM private_documents WHERE id IN (?)", [documentIds]);
    }
    await connection.execute("UPDATE discovery_posts SET status = 'REMOVED', caption = '' WHERE application_user_id = ?", [identity.userId]);
    await connection.execute("DELETE FROM application_user_avatars WHERE application_user_id = ?", [identity.userId]);
    await connection.execute("UPDATE private_messages SET body = '[deleted]' WHERE sender_application_user_id = ? OR recipient_application_user_id = ?", [identity.userId, identity.userId]);
    await connection.execute("DELETE FROM user_follows WHERE follower_application_user_id = ? OR followed_application_user_id = ?", [identity.userId, identity.userId]);
    await connection.execute("DELETE FROM agency_follows WHERE application_user_id = ?", [identity.userId]);
    await connection.execute("DELETE FROM private_message_blocks WHERE blocker_application_user_id = ? OR blocked_application_user_id = ?", [identity.userId, identity.userId]);
    await connection.execute("UPDATE host_profiles SET status = 'INACTIVE', verification_status = 'UNVERIFIED' WHERE application_user_id = ?", [identity.userId]);
    await connection.execute(
      "UPDATE platform_accounts SET application_user_id = NULL WHERE application_user_id IN (?, ?, ?)",
      [identity.userId, user.external_user_id, String(user.public_id)],
    );
    await connection.execute("UPDATE mobile_sessions SET revoked_at = CURRENT_TIMESTAMP(3) WHERE application_user_id = ? AND revoked_at IS NULL", [identity.userId]);
    await connection.execute(
      `UPDATE application_users SET
         external_user_id = ?, google_subject = NULL, email = NULL, full_name = 'Deleted user',
         avatar_url = NULL, country_code = NULL, date_of_birth = NULL, gender = NULL,
         bio = '', language_code = 'en', whatsapp_e164 = NULL, onboarding_completed = FALSE,
         deletion_requested_at = CURRENT_TIMESTAMP(3), public_profile_hidden = TRUE,
         account_status = 'INACTIVE', agency_account_id = NULL, is_host = FALSE,
         face_verification_status = 'NOT_SUBMITTED', agency_face_live_authorized = FALSE,
         super_admin_face_live_authorized = FALSE
       WHERE id = ?`,
      [`deleted:${deletionId}`, identity.userId],
    );
    await connection.execute(
      "UPDATE account_deletion_requests SET status = 'COMPLETED', processed_at = CURRENT_TIMESTAMP(3), process_note = 'Automated authenticated deletion and anonymization completed.' WHERE id = ?",
      [deletionId],
    );
    await connection.execute(
      `INSERT INTO audit_logs
        (id, action, module, target_type, target_id, new_data, reason)
       VALUES (?, 'account.deletion_completed', 'privacy', 'application_user', ?, ?, 'Authenticated in-app deletion')`,
      [randomUUID(), identity.userId, JSON.stringify({ requestId: deletionId, retainedCategories: retention.retained })],
    );
    return { completed: true, requestCode: code, message: "Your Nazraa account and public profile have been deleted." };
  });
}

function emailHash(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export async function createWebDeletionRequest(input: { email: string; publicId: string; message?: string }) {
  const email = input.email.trim().toLowerCase();
  const hashed = emailHash(email);
  const [matches] = await db().query<(RowDataPacket & { id: string })[]>(
    "SELECT id FROM application_users WHERE public_id = ? AND LOWER(email) = ? LIMIT 1",
    [input.publicId, email],
  );
  const protectedEmail = encryptPrivateText(email);
  const code = requestCode("DEL");
  await db().execute(
    `INSERT INTO account_deletion_requests
      (id, request_code, application_user_id, source, requester_email_hash,
       requester_email_encrypted, requester_email_iv, requester_email_tag, status, process_note)
     VALUES (?, ?, ?, 'WEB', ?, ?, ?, ?, 'IDENTITY_REVIEW', ?)`,
    [randomUUID(), code, matches[0]?.id ?? null, hashed, protectedEmail.encryptedData,
      protectedEmail.iv, protectedEmail.tag,
      input.message?.trim().slice(0, 500) || "Web account-deletion initiation"],
  );
  return { accepted: true, requestCode: code, message: "Your deletion request was received. Nazraa Support will verify the account before processing it." };
}

export async function createPublicSupportRequest(input: {
  category: "ACCOUNT" | "VERIFICATION" | "AGENCY" | "PURCHASE" | "SAFETY" | "PRIVACY" | "DELETION" | "CHILD_SAFETY" | "COPYRIGHT";
  email: string;
  subject: string;
  message: string;
}) {
  const protectedEmail = encryptPrivateText(input.email.trim().toLowerCase());
  const code = requestCode("SUP");
  await db().execute(
    `INSERT INTO public_support_requests
      (id, request_code, category, contact_email_hash, contact_email_encrypted,
       contact_email_iv, contact_email_tag, subject, message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), code, input.category, emailHash(input.email), protectedEmail.encryptedData,
      protectedEmail.iv, protectedEmail.tag, input.subject.trim(), input.message.trim()],
  );
  return { accepted: true, requestCode: code, message: "Your request was received by Nazraa Support." };
}
