import "server-only";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import type { PreparedDocument } from "@/lib/security/documents";

export async function syncApplicationUser(input: { externalUserId: string; fullName: string; countryCode: string; avatarUrl?: string; agencyCode?: string }) {
  let agencyId: string | null = null;
  if (input.agencyCode) {
    const [agencies] = await db().query<(RowDataPacket & { id: string })[]>("SELECT id FROM platform_accounts WHERE role = 'AGENCY' AND role_code = ? AND status = 'ACTIVE' LIMIT 1", [input.agencyCode.toUpperCase()]);
    agencyId = agencies[0]?.id ?? null;
  }
  const id = randomUUID();
  await db().execute(
    `INSERT INTO application_users (id, external_user_id, full_name, avatar_url, country_code, agency_account_id, last_active_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), avatar_url = VALUES(avatar_url), country_code = VALUES(country_code), agency_account_id = COALESCE(VALUES(agency_account_id), agency_account_id), last_active_at = CURRENT_TIMESTAMP(3)`,
    [id, input.externalUserId, input.fullName, input.avatarUrl || null, input.countryCode, agencyId],
  );
  const [rows] = await db().query<(RowDataPacket & { id: string })[]>("SELECT id FROM application_users WHERE external_user_id = ? LIMIT 1", [input.externalUserId]);
  return rows[0].id;
}

export async function createMobileHostApplication(input: { externalUserId: string; legalName: string; countryCode: string; governmentIdType: string; governmentIdLast4: string; agencyCode?: string; documents: PreparedDocument[] }) {
  const [users] = await db().query<(RowDataPacket & { id: string; agency_account_id: string | null })[]>("SELECT id, agency_account_id FROM application_users WHERE external_user_id = ? LIMIT 1", [input.externalUserId]);
  const user = users[0]; if (!user) throw new Error("Sync the application user before submitting a host application.");
  let agencyId = user.agency_account_id;
  if (input.agencyCode) {
    const [agencies] = await db().query<(RowDataPacket & { id: string })[]>("SELECT id FROM platform_accounts WHERE role = 'AGENCY' AND role_code = ? AND status = 'ACTIVE' LIMIT 1", [input.agencyCode.toUpperCase()]);
    if (!agencies[0]) throw new Error("Agency code was not found."); agencyId = agencies[0].id;
  }
  const hostId = randomUUID();
  await withTransaction(async (connection) => {
    await connection.execute(
      `INSERT INTO host_profiles (id, application_user_id, legal_name, agency_account_id, country_code, status, verification_status, government_id_type, government_id_last4)
       VALUES (?, ?, ?, ?, ?, 'PENDING', 'PENDING', ?, ?)`,
      [hostId, user.id, input.legalName, agencyId, input.countryCode, input.governmentIdType, input.governmentIdLast4],
    );
    for (const document of input.documents) await connection.execute(
      `INSERT INTO private_documents (id, owner_type, owner_id, document_type, original_name, mime_type, byte_size, encrypted_data, encryption_iv, encryption_tag)
       VALUES (?, 'HOST_APPLICATION', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [document.id, hostId, document.documentType, document.originalName, document.mimeType, document.byteSize, document.encryptedData, document.iv, document.tag],
    );
    await connection.execute("INSERT INTO audit_logs (id, actor_role, action, module, target_type, target_id, reason) VALUES (?, 'MOBILE_USER', 'host.application_submit', 'hosts', 'host_application', ?, 'Submitted from mobile API')", [randomUUID(), hostId]);
  });
  return hostId;
}

export async function createMobileSupportTicket(input: { externalUserId: string; subject: string; category: string; priority: string; message: string }) {
  const [users] = await db().query<(RowDataPacket & { id: string })[]>("SELECT id FROM application_users WHERE external_user_id = ? LIMIT 1", [input.externalUserId]);
  if (!users[0]) throw new Error("Sync the application user before creating a ticket.");
  const id = randomUUID(); const code = `TKT-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 5).toUpperCase()}`;
  await withTransaction(async (connection) => {
    await connection.execute("INSERT INTO support_tickets (id, ticket_code, application_user_id, subject, category, priority) VALUES (?, ?, ?, ?, ?, ?)", [id, code, users[0].id, input.subject, input.category, input.priority]);
    await connection.execute("INSERT INTO support_messages (id, ticket_id, sender_type, sender_id, message) VALUES (?, ?, 'APPLICATION_USER', ?, ?)", [randomUUID(), id, users[0].id, input.message]);
  });
  return { id, code };
}

export async function publicMobileConfig() {
  const [gifts] = await db().query<RowDataPacket[]>("SELECT gift_key `key`, name, category, coin_price coinPrice, visual_url visualUrl, animation_key animationKey FROM gift_catalog WHERE active = TRUE ORDER BY coin_price, name");
  const [banners] = await db().query<RowDataPacket[]>(
    `SELECT id, placement, title, subtitle, image_url imageUrl, action_type actionType, action_target actionTarget, priority
     FROM banners WHERE active = TRUE AND (starts_at IS NULL OR starts_at <= CURRENT_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at > CURRENT_TIMESTAMP(3)) ORDER BY priority DESC`,
  );
  const [notifications] = await db().query<RowDataPacket[]>(
    `SELECT id, title, message, audience_role audienceRole, action_target actionTarget, COALESCE(published_at, scheduled_at) publishedAt
     FROM platform_notifications WHERE status = 'PUBLISHED' OR (status = 'SCHEDULED' AND scheduled_at <= CURRENT_TIMESTAMP(3)) ORDER BY COALESCE(published_at, scheduled_at) DESC LIMIT 30`,
  );
  const [settings] = await db().query<(RowDataPacket & { setting_key: string; setting_value: unknown })[]>("SELECT setting_key, setting_value FROM system_settings");
  return { gifts, banners, notifications, settings: Object.fromEntries(settings.map((item) => [item.setting_key, typeof item.setting_value === "string" ? JSON.parse(item.setting_value) : item.setting_value])) };
}
