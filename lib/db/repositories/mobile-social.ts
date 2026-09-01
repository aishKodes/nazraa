import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { publicImageFromDataUrl } from "@/lib/security/public-images";
import { encryptPrivateText, preparePrivateDocumentDataUrl } from "@/lib/security/documents";

export async function agencyApplicationsForUser(identity: MobileIdentity) {
  try {
    const [joins, creations] = await Promise.all([
    db().query<RowDataPacket[]>(
      `SELECT application.id, application.status, application.review_reason, application.created_at,
              agency.public_id agency_public_id, agency.full_name agency_name
       FROM agency_membership_applications application
       INNER JOIN platform_accounts agency ON agency.id = application.agency_account_id
       WHERE application.application_user_id = ? ORDER BY application.created_at DESC LIMIT 20`,
      [identity.userId],
    ),
    db().query<RowDataPacket[]>(
      `SELECT application.id, application.status, application.review_reason, application.created_at,
              approved.public_id agency_public_id, application.agency_name,
              parent.public_id parent_public_id, parent.full_name parent_name, parent.role parent_role
       FROM agency_creation_applications application
       LEFT JOIN platform_accounts approved ON approved.id = application.approved_agency_account_id
       LEFT JOIN platform_accounts parent ON parent.id = application.parent_account_id
       WHERE application.application_user_id = ? ORDER BY application.created_at DESC LIMIT 20`,
      [identity.userId],
    ),
    ]);
    return [
      ...joins[0].map((row) => ({ id: String(row.id), type: "join", status: String(row.status).toLowerCase(), agencyId: String(row.agency_public_id), agencyName: String(row.agency_name), reviewReason: row.review_reason, createdAt: row.created_at })),
      ...creations[0].map((row) => ({ id: String(row.id), type: "create", status: String(row.status).toLowerCase(), agencyId: row.agency_public_id == null ? null : String(row.agency_public_id), agencyName: String(row.agency_name), logoUrl: `https://nazraa.vercel.app/api/v1/assets/agencies/${row.id}`, reviewReason: row.review_reason, parent: row.parent_public_id == null ? null : { id: String(row.parent_public_id), name: String(row.parent_name), role: row.parent_role === "BD" ? "BD" : "Admin" }, createdAt: row.created_at })),
    ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  } catch (error) {
    // Keeps mobile bootstrap available while a production migration rolls out.
    if ((error as { code?: string }).code === "ER_NO_SUCH_TABLE") return [];
    throw error;
  }
}

export async function searchAgency(publicId: string) {
  const [rows] = await db().query<RowDataPacket[]>(
    `SELECT agency.id, agency.public_id, agency.full_name, agency.country_code, agency.status,
            owner.public_id owner_public_id, owner.full_name owner_name,
            COUNT(host.id) host_count
     FROM platform_accounts agency
     LEFT JOIN application_users owner
       ON owner.id = agency.application_user_id
       OR owner.external_user_id = agency.application_user_id
       OR CAST(owner.public_id AS CHAR) = agency.application_user_id
     LEFT JOIN host_profiles host ON host.agency_account_id = agency.id AND host.status = 'ACTIVE'
     WHERE agency.public_id = ? AND agency.role = 'AGENCY' AND agency.status = 'ACTIVE'
     GROUP BY agency.id, agency.public_id, agency.full_name, agency.country_code, agency.status,
              owner.public_id, owner.full_name LIMIT 1`,
    [publicId],
  );
  const agency = rows[0];
  if (!agency) throw new Error("No active Agency was found with that six-digit ID.");
  if (agency.owner_public_id == null) throw new Error("This Agency does not have an active Agency Owner yet.");
  return {
    id: String(agency.public_id), name: String(agency.full_name), country: agency.country_code ?? "",
    status: String(agency.status), hostCount: Number(agency.host_count),
    owner: agency.owner_public_id == null ? null : { id: String(agency.owner_public_id), name: String(agency.owner_name) },
  };
}

export async function verifyAgencyParent(publicId: string) {
  const [rows] = await db().query<(RowDataPacket & { id: string; public_id: number; full_name: string; role: "ADMIN" | "BD" })[]>(
    `SELECT id, public_id, full_name, role
     FROM platform_accounts
     WHERE public_id = ? AND role IN ('ADMIN','BD') AND status = 'ACTIVE' LIMIT 1`,
    [publicId],
  );
  const parent = rows[0];
  if (!parent) throw new Error("No active Admin or BD was found with that six-digit code.");
  return { id: String(parent.public_id), name: parent.full_name, role: parent.role === "BD" ? "BD" : "Admin" };
}

export async function applyToJoinAgency(identity: MobileIdentity, publicId: string) {
  return withTransaction(async (connection) => {
    const [users] = await connection.query<(RowDataPacket & { agency_account_id: string | null })[]>("SELECT agency_account_id FROM application_users WHERE id = ? LIMIT 1 FOR UPDATE", [identity.userId]);
    if (!users[0]) throw new Error("Your Nazraa account was not found.");
    if (users[0].agency_account_id) throw new Error("Your Agency Owner must remove you before you can join another Agency.");
    const [agencies] = await connection.query<(RowDataPacket & { id: string; full_name: string; owner_user_id: string | null })[]>(
      `SELECT agency.id, agency.full_name,
              (SELECT owner.id FROM application_users owner
               WHERE owner.id = agency.application_user_id OR owner.external_user_id = agency.application_user_id
                  OR CAST(owner.public_id AS CHAR) = agency.application_user_id LIMIT 1) owner_user_id
       FROM platform_accounts agency
       WHERE agency.public_id = ? AND agency.role = 'AGENCY' AND agency.status = 'ACTIVE' LIMIT 1`,
      [publicId],
    );
    if (!agencies[0]) throw new Error("No active Agency was found with that six-digit ID.");
    if (!agencies[0].owner_user_id) throw new Error("This Agency does not have an active Agency Owner yet.");
    if (agencies[0].owner_user_id === identity.userId) throw new Error("You already own this Agency.");
    const [openMemberships] = await connection.query<RowDataPacket[]>("SELECT id FROM agency_membership_applications WHERE application_user_id = ? AND status IN ('PENDING','APPROVED') LIMIT 1", [identity.userId]);
    if (openMemberships.length) throw new Error("You already have an active or pending Agency membership.");
    const [pendingCreations] = await connection.query<RowDataPacket[]>("SELECT id FROM agency_creation_applications WHERE application_user_id = ? AND status = 'PENDING' LIMIT 1", [identity.userId]);
    if (pendingCreations.length) throw new Error("Your Agency creation application must be reviewed before you can join another Agency.");
    const applicationId = randomUUID();
    await connection.execute("INSERT INTO agency_membership_applications (id, application_user_id, agency_account_id) VALUES (?, ?, ?)", [applicationId, identity.userId, agencies[0].id]);
    await connection.execute("INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'AGENCY', 'Agency application pending', ?, 'agency')", [randomUUID(), identity.userId, `Your request to join ${agencies[0].full_name} is waiting for approval.`]);
    await connection.execute("INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'AGENCY', 'New Agency join request', ?, 'agency')", [randomUUID(), agencies[0].owner_user_id, `${identity.fullName} requested to join ${agencies[0].full_name}.`]);
    return { id: applicationId, status: "pending" };
  });
}

export async function agencyOwnerSnapshot(identity: MobileIdentity) {
  const [ownerRows] = await db().query<(RowDataPacket & { id: string })[]>(
    `SELECT account.id FROM platform_accounts account
     WHERE account.role = 'AGENCY' AND account.status = 'ACTIVE'
       AND (account.application_user_id = ? OR account.application_user_id = ? OR account.application_user_id = ?)
     LIMIT 1`,
    [identity.userId, identity.externalUserId, identity.publicId],
  );
  const owner = ownerRows[0];
  if (!owner) return { isOwner: false, hosts: [], joinRequests: [] };
  const [hosts, requests] = await Promise.all([
    db().query<RowDataPacket[]>(
      `SELECT user.public_id, user.full_name, user.country_code, user.language_code, user.level_number,
              user.anchor_income_points, user.vip_tier, user.is_host, host.status, host.live_minutes_30d,
              host.sessions_30d, host.gifts_value_30d,
              CASE WHEN avatar.updated_at IS NOT NULL
                THEN CONCAT('https://nazraa.vercel.app/api/v1/mobile/avatar/', user.public_id, '?v=', FLOOR(UNIX_TIMESTAMP(avatar.updated_at) * 1000))
                ELSE user.avatar_url END avatar_url
       FROM application_users user
       INNER JOIN host_profiles host ON host.application_user_id = user.id AND host.agency_account_id = ?
       LEFT JOIN application_user_avatars avatar ON avatar.application_user_id = user.id
       WHERE user.account_status = 'ACTIVE' AND user.id != ?
       ORDER BY host.updated_at DESC LIMIT 100`,
      [owner.id, identity.userId],
    ),
    db().query<RowDataPacket[]>(
      `SELECT application.id, application.created_at, user.public_id, user.full_name, user.country_code,
              user.language_code, user.level_number, user.anchor_income_points, user.vip_tier, user.is_host,
              CASE WHEN avatar.updated_at IS NOT NULL
                THEN CONCAT('https://nazraa.vercel.app/api/v1/mobile/avatar/', user.public_id, '?v=', FLOOR(UNIX_TIMESTAMP(avatar.updated_at) * 1000))
                ELSE user.avatar_url END avatar_url
       FROM agency_membership_applications application
       INNER JOIN application_users user ON user.id = application.application_user_id AND user.account_status = 'ACTIVE'
       LEFT JOIN application_user_avatars avatar ON avatar.application_user_id = user.id
       WHERE application.agency_account_id = ? AND application.status = 'PENDING'
       ORDER BY application.created_at ASC LIMIT 50`,
      [owner.id],
    ),
  ]);
  const user = (row: RowDataPacket) => ({
    id: String(row.public_id), name: String(row.full_name), avatarUrl: row.avatar_url,
    country: row.country_code ?? "", language: row.language_code ?? "", level: Number(row.level_number),
    anchorLevel: Math.min(200, Math.floor(Math.sqrt(Math.max(0, Number(row.anchor_income_points ?? 0)) / 500)) + 1),
    vip: Number(row.vip_tier), role: row.is_host ? "host" : "user",
  });
  return {
    isOwner: true,
    hosts: hosts[0].map((row) => ({
      user: user(row), liveMinutes: Number(row.live_minutes_30d), validDays: Number(row.sessions_30d),
      targetProgress: Math.min(1, Number(row.live_minutes_30d) / 1800), status: String(row.status).toLowerCase(),
      giftEarnings: Number(row.gifts_value_30d),
    })),
    joinRequests: requests[0].map((row) => ({ id: String(row.id), user: user(row), createdAt: row.created_at })),
  };
}

async function agencyOwnedBy(connection: PoolConnection, identity: MobileIdentity) {
  const [rows] = await connection.query<(RowDataPacket & { id: string; full_name: string })[]>(
    `SELECT account.id, account.full_name FROM platform_accounts account
     WHERE account.role = 'AGENCY' AND account.status = 'ACTIVE'
       AND (account.application_user_id = ? OR account.application_user_id = ? OR account.application_user_id = ?)
     LIMIT 1 FOR UPDATE`,
    [identity.userId, identity.externalUserId, identity.publicId],
  );
  if (!rows[0]) throw new Error("Only the Agency Owner can manage membership.");
  return rows[0];
}

export async function reviewOwnAgencyJoin(identity: MobileIdentity, input: { applicationId: string; decision: "APPROVED" | "REJECTED"; reason?: string }) {
  return withTransaction(async (connection) => {
    const agency = await agencyOwnedBy(connection, identity);
    const [applications] = await connection.query<(RowDataPacket & { id: string; application_user_id: string; status: string; user_name: string })[]>(
      `SELECT application.id, application.application_user_id, application.status, user.full_name user_name
       FROM agency_membership_applications application
       INNER JOIN application_users user ON user.id = application.application_user_id
       WHERE application.id = ? AND application.agency_account_id = ? LIMIT 1 FOR UPDATE`,
      [input.applicationId, agency.id],
    );
    const application = applications[0];
    if (!application || application.status !== "PENDING") throw new Error("That join request is no longer pending.");
    const reason = input.reason?.trim() || (input.decision === "APPROVED" ? "Accepted by Agency Owner" : "Rejected by Agency Owner");
    if (input.decision === "APPROVED") {
      const [users] = await connection.query<(RowDataPacket & { agency_account_id: string | null })[]>("SELECT agency_account_id FROM application_users WHERE id = ? LIMIT 1 FOR UPDATE", [application.application_user_id]);
      if (!users[0]) throw new Error("The applicant account no longer exists.");
      if (users[0].agency_account_id) throw new Error("The applicant already belongs to an Agency.");
      const [pendingCreations] = await connection.query<RowDataPacket[]>("SELECT id FROM agency_creation_applications WHERE application_user_id = ? AND status = 'PENDING' LIMIT 1", [application.application_user_id]);
      if (pendingCreations.length) throw new Error("The applicant has a pending Agency creation application.");
      await connection.execute("UPDATE application_users SET agency_account_id = ? WHERE id = ?", [agency.id, application.application_user_id]);
      await connection.execute("UPDATE host_profiles SET agency_account_id = ? WHERE application_user_id = ?", [agency.id, application.application_user_id]);
    }
    await connection.execute("UPDATE agency_membership_applications SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP(3), review_reason = ? WHERE id = ?", [input.decision, agency.id, reason, application.id]);
    await connection.execute("INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'AGENCY', ?, ?, 'agency')", [randomUUID(), application.application_user_id, `Agency request ${input.decision.toLowerCase()}`, input.decision === "APPROVED" ? `You are now a member of ${agency.full_name}.` : reason]);
    await connection.execute("INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, new_data, reason) VALUES (?, ?, 'AGENCY', 'agency.join_review', 'agencies', 'agency_membership_application', ?, ?, ?)", [randomUUID(), agency.id, application.id, JSON.stringify({ status: input.decision, applicationUserId: application.application_user_id }), reason]);
    return { status: input.decision.toLowerCase() };
  });
}

export async function removeOwnAgencyHost(identity: MobileIdentity, input: { targetPublicId: string; reason: string }) {
  return withTransaction(async (connection) => {
    const agency = await agencyOwnedBy(connection, identity);
    const [users] = await connection.query<(RowDataPacket & { id: string; full_name: string })[]>(
      `SELECT id, full_name FROM application_users
       WHERE public_id = ? AND agency_account_id = ? AND id != ? LIMIT 1 FOR UPDATE`,
      [input.targetPublicId, agency.id, identity.userId],
    );
    const user = users[0];
    if (!user) throw new Error("That host is not an active member of your Agency.");
    await connection.execute("UPDATE application_users SET agency_account_id = NULL WHERE id = ? AND agency_account_id = ?", [user.id, agency.id]);
    await connection.execute("UPDATE host_profiles SET agency_account_id = NULL WHERE application_user_id = ? AND agency_account_id = ?", [user.id, agency.id]);
    await connection.execute("UPDATE agency_membership_applications SET status = 'REMOVED', ended_by = ?, ended_at = CURRENT_TIMESTAMP(3), end_reason = ? WHERE application_user_id = ? AND agency_account_id = ? AND status = 'APPROVED'", [agency.id, input.reason, user.id, agency.id]);
    await connection.execute("INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'AGENCY', 'Agency membership ended', ?, 'agency')", [randomUUID(), user.id, `You were removed from ${agency.full_name}. You can now join or create another Agency.`]);
    await connection.execute("INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, previous_data, new_data, reason) VALUES (?, ?, 'AGENCY', 'agency.host_remove', 'agencies', 'application_user', ?, ?, ?, ?)", [randomUUID(), agency.id, user.id, JSON.stringify({ agencyAccountId: agency.id }), JSON.stringify({ agencyAccountId: null }), input.reason]);
    return { status: "removed" };
  });
}

export async function applyToCreateAgency(identity: MobileIdentity, input: {
  name: string;
  ownerName: string;
  countryCode: string;
  whatsappE164: string;
  aadhaar: string;
  parentCode: string;
  documentDataUrl: string;
  documentName: string;
  additionalDocuments?: { dataUrl: string; name: string }[];
  logoDataUrl?: string;
}) {
  if (!input.logoDataUrl) throw new Error("Agency logo is required.");
  if (input.additionalDocuments?.length !== 2) throw new Error("Upload Aadhaar front, Aadhaar back, and a selfie holding Aadhaar.");
  const logo = input.logoDataUrl
    ? await publicImageFromDataUrl(input.logoDataUrl, 1024 * 1024, "Agency logo", { maxWidth: 900, maxHeight: 900 })
    : null;
  const proof = preparePrivateDocumentDataUrl({ dataUrl: input.documentDataUrl, id: randomUUID(), documentType: "AADHAAR_FRONT", originalName: "aadhaar-front.jpg" });
  const protectedNames = ["aadhaar-back.jpg", "aadhaar-selfie.jpg"];
  const protectedTypes = ["AADHAAR_BACK", "AADHAAR_SELFIE"];
  const otherProofs = input.additionalDocuments.map((document, index) => preparePrivateDocumentDataUrl({ dataUrl: document.dataUrl, id: randomUUID(), documentType: protectedTypes[index], originalName: protectedNames[index] }));
  const aadhaar = input.aadhaar.replace(/\D/g, "");
  const encryptedAadhaar = encryptPrivateText(aadhaar);
  return withTransaction(async (connection) => {
    const [users] = await connection.query<(RowDataPacket & { agency_account_id: string | null })[]>("SELECT agency_account_id FROM application_users WHERE id = ? LIMIT 1 FOR UPDATE", [identity.userId]);
    if (users[0]?.agency_account_id) throw new Error("This account is already linked to an Agency.");
    const [openMemberships] = await connection.query<RowDataPacket[]>("SELECT id FROM agency_membership_applications WHERE application_user_id = ? AND status IN ('PENDING','APPROVED') LIMIT 1", [identity.userId]);
    if (openMemberships.length) throw new Error("Your existing Agency membership request must be resolved first.");
    const [pending] = await connection.query<RowDataPacket[]>("SELECT id FROM agency_creation_applications WHERE application_user_id = ? AND status = 'PENDING' LIMIT 1", [identity.userId]);
    if (pending.length) throw new Error("Your Agency creation application is already pending.");
    const [parents] = await connection.query<(RowDataPacket & { id: string; public_id: number; full_name: string; role: "ADMIN" | "BD" })[]>(
      "SELECT id, public_id, full_name, role FROM platform_accounts WHERE public_id = ? AND role IN ('ADMIN','BD') AND status = 'ACTIVE' LIMIT 1 FOR SHARE",
      [input.parentCode],
    );
    const parent = parents[0];
    if (!parent) throw new Error("The selected Admin or BD is no longer active. Verify the parent code again.");
    const applicationId = randomUUID();
    await connection.execute(
      `INSERT INTO agency_creation_applications
        (id, application_user_id, agency_name, owner_name, country_code, business_whatsapp_e164, parent_account_id,
         aadhaar_last4, aadhaar_encrypted, aadhaar_iv, aadhaar_tag,
         logo_mime_type, logo_data, logo_byte_size, document_original_name, document_mime_type, document_byte_size,
         document_encrypted_data, document_encryption_iv, document_encryption_tag)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [applicationId, identity.userId, input.name, input.ownerName, input.countryCode, input.whatsappE164, parent.id,
       aadhaar.slice(-4), encryptedAadhaar.encryptedData, encryptedAadhaar.iv, encryptedAadhaar.tag,
       logo?.mimeType ?? null, logo?.data ?? null, logo?.byteSize ?? null,
       proof.originalName, proof.mimeType, proof.byteSize, proof.encryptedData, proof.iv, proof.tag],
    );
    for (const [index, document] of [proof, ...otherProofs].entries()) {
      await connection.execute("INSERT INTO agency_application_documents (id, application_id, slot, original_name, mime_type, byte_size, encrypted_data, encryption_iv, encryption_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [randomUUID(), applicationId, index + 1, document.originalName, document.mimeType, document.byteSize, document.encryptedData, document.iv, document.tag]);
    }
    await connection.execute("INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'AGENCY', 'Agency creation pending', 'Nazraa Master will review this application.', 'agency')", [randomUUID(), identity.userId]);
    await connection.execute("INSERT INTO audit_logs (id, action, module, target_type, target_id, new_data, reason) VALUES (?, 'agency.creation_submit', 'agencies', 'agency_creation_application', ?, ?, 'Submitted from authenticated mobile account')", [randomUUID(), applicationId, JSON.stringify({ parentAccountId: parent.id, parentPublicId: Number(parent.public_id), hasEncryptedKyc: true })]);
    return { status: "pending", parent: { id: String(parent.public_id), name: parent.full_name, role: parent.role === "BD" ? "BD" : "Admin" } };
  });
}

export async function discoveryPosts(after?: string) {
  try {
    const [rows] = await db().query<RowDataPacket[]>(
      `SELECT post.id, post.caption, post.status, post.created_at, asset.id asset_id,
              user.public_id, user.full_name, user.country_code,
              CASE WHEN avatar.updated_at IS NOT NULL THEN CONCAT('https://nazraa.vercel.app/api/v1/mobile/avatar/', user.public_id, '?v=', FLOOR(UNIX_TIMESTAMP(avatar.updated_at) * 1000)) ELSE user.avatar_url END avatar_url,
              user.level_number, LEAST(200, FLOOR(SQRT(GREATEST(0, user.anchor_income_points) / 500)) + 1) anchor_level, user.vip_tier, user.is_host
       FROM discovery_posts post
       LEFT JOIN discovery_post_assets asset ON asset.id = post.asset_id
       INNER JOIN application_users user ON user.id = post.application_user_id
       LEFT JOIN application_user_avatars avatar ON avatar.application_user_id = user.id
       WHERE post.status IN ('VISIBLE','UNDER_REVIEW')
         ${after ? "AND (post.created_at, post.id) < (SELECT created_at, id FROM discovery_posts WHERE id = ?)" : ""}
       ORDER BY post.created_at DESC, post.id DESC LIMIT 30`,
      after ? [after] : [],
    );
    return rows.map((row) => ({
      id: String(row.id), type: row.asset_id ? "photo" : "text", caption: String(row.caption),
      mediaUrl: row.asset_id ? `https://nazraa.vercel.app/api/v1/assets/discovery/${row.asset_id}` : null,
      createdAt: row.created_at, moderationStatus: String(row.status).toLowerCase().replace("_", ""),
      author: { id: String(row.public_id), name: String(row.full_name), avatarUrl: row.avatar_url, country: row.country_code ?? "", level: Number(row.level_number), anchorLevel: Number(row.anchor_level), vip: Number(row.vip_tier), role: row.is_host ? "host" : "user" },
    }));
  } catch (error) {
    if ((error as { code?: string }).code === "ER_NO_SUCH_TABLE") return [];
    throw error;
  }
}

export async function createDiscoveryPost(identity: MobileIdentity, input: { caption: string; photoDataUrl?: string }) {
  if (!input.caption.trim() && !input.photoDataUrl) throw new Error("Write something or add a photo.");
  const image = input.photoDataUrl ? await publicImageFromDataUrl(input.photoDataUrl, 1536 * 1024, "Post photo", { maxWidth: 1440, maxHeight: 1920 }) : null;
  const assetId = image ? randomUUID() : null;
  const postId = randomUUID();
  await withTransaction(async (connection) => {
    if (image) await connection.execute("INSERT INTO discovery_post_assets (id, owner_application_user_id, mime_type, image_data, byte_size) VALUES (?, ?, ?, ?, ?)", [assetId, identity.userId, image.mimeType, image.data, image.byteSize]);
    await connection.execute("INSERT INTO discovery_posts (id, application_user_id, asset_id, caption) VALUES (?, ?, ?, ?)", [postId, identity.userId, assetId, input.caption]);
  });
  return { id: postId, status: "VISIBLE" };
}

export async function deleteDiscoveryPost(identity: MobileIdentity, postId: string) {
  const [result] = await db().execute("UPDATE discovery_posts SET status = 'REMOVED' WHERE id = ? AND application_user_id = ? AND status != 'REMOVED'", [postId, identity.userId]);
  if ((result as { affectedRows?: number }).affectedRows !== 1) throw new Error("This post is not available to delete.");
  return { status: "REMOVED" };
}

export async function reportDiscoveryPost(identity: MobileIdentity, input: { postId: string; reason: string }) {
  await withTransaction(async (connection) => {
    const [posts] = await connection.query<(RowDataPacket & { application_user_id: string; status: string })[]>("SELECT application_user_id, status FROM discovery_posts WHERE id = ? LIMIT 1 FOR UPDATE", [input.postId]);
    if (!posts[0] || posts[0].status === "REMOVED") throw new Error("This post is no longer available.");
    if (posts[0].application_user_id === identity.userId) throw new Error("You cannot report your own post.");
    await connection.execute("INSERT INTO discovery_post_reports (post_id, reporter_application_user_id, reason) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE reason = VALUES(reason)", [input.postId, identity.userId, input.reason]);
    const [counts] = await connection.query<(RowDataPacket & { total: number })[]>("SELECT COUNT(*) total FROM discovery_post_reports WHERE post_id = ?", [input.postId]);
    if (Number(counts[0].total) >= 3) await connection.execute("UPDATE discovery_posts SET status = 'UNDER_REVIEW' WHERE id = ? AND status = 'VISIBLE'", [input.postId]);
  });
  return { reported: true };
}

function settingObject(value: unknown) {
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function privateMessagePricing(value: unknown) {
  const setting = settingObject(value);
  const configuredCost = Number(setting.private_message_coin_cost ?? 10);
  const configuredLimit = Number(setting.private_message_daily_paid_limit ?? 20);
  return {
    coinCost: Number.isFinite(configuredCost) ? Math.max(0, Math.floor(configuredCost)) : 10,
    dailyPaidLimit: Number.isFinite(configuredLimit) ? Math.max(0, Math.floor(configuredLimit)) : 20,
  };
}

export async function privateMessagingForUser(identity: MobileIdentity, before?: string) {
  try {
    const [messages, settingRows, blocks, usageRows, clockRows] = await Promise.all([
      db().query<RowDataPacket[]>(
        `SELECT message.id, message.client_message_id, sender.public_id sender_public_id,
                recipient.public_id recipient_public_id, message.body, message.coin_cost,
                message.read_at, message.created_at, conversation.status conversation_status,
                initiator.public_id initiated_by_public_id,
                sender.full_name sender_name, sender.avatar_url sender_avatar,
                recipient.full_name recipient_name, recipient.avatar_url recipient_avatar
         FROM private_messages message
         INNER JOIN application_users sender ON sender.id = message.sender_application_user_id
         INNER JOIN application_users recipient ON recipient.id = message.recipient_application_user_id
         INNER JOIN private_conversations conversation
           ON conversation.user_low = LEAST(message.sender_application_user_id, message.recipient_application_user_id)
          AND conversation.user_high = GREATEST(message.sender_application_user_id, message.recipient_application_user_id)
         INNER JOIN application_users initiator ON initiator.id = conversation.initiated_by
         WHERE (message.sender_application_user_id = ? OR message.recipient_application_user_id = ?)
           ${before ? "AND (message.created_at, message.id) < (SELECT created_at, id FROM private_messages WHERE id = ?)" : ""}
         ORDER BY message.created_at DESC, message.id DESC LIMIT 60`,
        [identity.userId, identity.userId, ...(before ? [before] : [])],
      ),
      db().query<(RowDataPacket & { setting_value: unknown })[]>("SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.social' LIMIT 1"),
      db().query<RowDataPacket[]>(
        `SELECT blocked.public_id FROM private_message_blocks blocklist
         INNER JOIN application_users blocked ON blocked.id = blocklist.blocked_application_user_id
         WHERE blocklist.blocker_application_user_id = ?`,
        [identity.userId],
      ),
      db().query<RowDataPacket[]>(
        `SELECT paid_message_count, total_message_count
         FROM private_message_daily_usage
         WHERE application_user_id = ? AND usage_date = CURRENT_DATE
         LIMIT 1`,
        [identity.userId],
      ),
      db().query<RowDataPacket[]>("SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d') server_date"),
    ]);
    const pricing = privateMessagePricing(settingRows[0][0]?.setting_value);
    const paidMessagesToday = Math.max(0, Number(usageRows[0][0]?.paid_message_count ?? 0));
    const totalMessagesToday = Math.max(0, Number(usageRows[0][0]?.total_message_count ?? 0));
    const remainingPaidMessages = Math.max(0, pricing.dailyPaidLimit - paidMessagesToday);
    return {
      hasMore: messages[0].length === 60,
      coinCost: pricing.coinCost,
      dailyPaidLimit: pricing.dailyPaidLimit,
      paidMessagesToday,
      totalMessagesToday,
      remainingPaidMessages,
      nextMessageCoinCost: remainingPaidMessages > 0 ? pricing.coinCost : 0,
      serverDate: String(clockRows[0][0]?.server_date ?? ""),
      blockedUserIds: blocks[0].map((row) => String(row.public_id)),
      people: [...new Map(messages[0].flatMap((row) => [
        [String(row.sender_public_id), { id: String(row.sender_public_id), name: String(row.sender_name), avatarUrl: row.sender_avatar }],
        [String(row.recipient_public_id), { id: String(row.recipient_public_id), name: String(row.recipient_name), avatarUrl: row.recipient_avatar }],
      ] as [string, { id: string; name: string; avatarUrl: unknown }][])).values()],
      messages: messages[0].map((row) => ({ id: String(row.id), clientMessageId: String(row.client_message_id), senderId: String(row.sender_public_id), recipientId: String(row.recipient_public_id), body: String(row.body), coinCost: Number(row.coin_cost), read: row.read_at != null, createdAt: row.created_at, conversationStatus: String(row.conversation_status).toLowerCase(), initiatedBy: String(row.initiated_by_public_id) })),
    };
  } catch (error) {
    if ((error as { code?: string }).code === "ER_NO_SUCH_TABLE") return {
      coinCost: 10, dailyPaidLimit: 20, paidMessagesToday: 0,
      totalMessagesToday: 0, remainingPaidMessages: 20,
      nextMessageCoinCost: 10, serverDate: "", blockedUserIds: [], messages: [],
    };
    throw error;
  }
}

export async function sendPrivateMessage(identity: MobileIdentity, input: { recipientPublicId: string; body: string; clientMessageId: string }) {
  return withTransaction(async (connection) => {
    const [recipients] = await connection.query<(RowDataPacket & { id: string })[]>("SELECT id FROM application_users WHERE public_id = ? AND account_status = 'ACTIVE' LIMIT 1", [input.recipientPublicId]);
    const recipient = recipients[0];
    if (!recipient || recipient.id === identity.userId) throw new Error("Choose another active Nazraa user.");
    const [blocks] = await connection.query<RowDataPacket[]>("SELECT blocker_application_user_id FROM private_message_blocks WHERE (blocker_application_user_id = ? AND blocked_application_user_id = ?) OR (blocker_application_user_id = ? AND blocked_application_user_id = ?) LIMIT 1", [identity.userId, recipient.id, recipient.id, identity.userId]);
    if (blocks.length) throw new Error("Messaging is unavailable for this conversation.");
    const [low, high] = [identity.userId, recipient.id].sort();
    await connection.execute("INSERT IGNORE INTO private_conversations (user_low, user_high, initiated_by) VALUES (?, ?, ?)", [low, high, identity.userId]);
    const [conversations] = await connection.query<RowDataPacket[]>("SELECT status, initiated_by FROM private_conversations WHERE user_low = ? AND user_high = ? FOR UPDATE", [low, high]);
    const conversation = conversations[0];
    const [settingRows] = await connection.query<(RowDataPacket & { setting_value: unknown })[]>("SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.social' LIMIT 1");
    const pricing = privateMessagePricing(settingRows[0]?.setting_value);
    await connection.execute("INSERT IGNORE INTO wallet_balances (id, owner_type, owner_id, asset_type) VALUES (?, 'APPLICATION_USER', ?, 'COIN')", [randomUUID(), identity.userId]);
    const [wallets] = await connection.query<(RowDataPacket & { id: string; available_balance: number })[]>("SELECT id, available_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' LIMIT 1 FOR UPDATE", [identity.userId]);
    await connection.execute(
      "INSERT IGNORE INTO private_message_daily_usage (application_user_id, usage_date) VALUES (?, CURRENT_DATE)",
      [identity.userId],
    );
    const [usageRows] = await connection.query<(RowDataPacket & { paid_message_count: number; total_message_count: number; server_date: string })[]>(
      `SELECT paid_message_count, total_message_count,
              DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d') server_date
       FROM private_message_daily_usage
       WHERE application_user_id = ? AND usage_date = CURRENT_DATE
       LIMIT 1 FOR UPDATE`,
      [identity.userId],
    );
    const usage = usageRows[0];
    const paidMessagesToday = Math.max(0, Number(usage?.paid_message_count ?? 0));
    const totalMessagesToday = Math.max(0, Number(usage?.total_message_count ?? 0));
    const [existing] = await connection.query<(RowDataPacket & { id: string; coin_cost: number })[]>("SELECT id, coin_cost FROM private_messages WHERE sender_application_user_id = ? AND client_message_id = ? LIMIT 1", [identity.userId, input.clientMessageId]);
    if (existing[0]) {
      const remainingPaidMessages = Math.max(0, pricing.dailyPaidLimit - paidMessagesToday);
      return {
        id: existing[0].id, coinCost: Number(existing[0].coin_cost), alreadySent: true,
        paidMessagesToday, totalMessagesToday, remainingPaidMessages,
        nextMessageCoinCost: remainingPaidMessages > 0 ? pricing.coinCost : 0,
        serverDate: String(usage?.server_date ?? ""),
        remainingCoins: Number(wallets[0].available_balance),
      };
    }
    if (conversation.status === "REJECTED") throw new Error("This message request was declined.");
    if (conversation.status === "PENDING") {
      if (conversation.initiated_by !== identity.userId) throw new Error("Accept this message request before replying.");
      const [pendingMessages] = await connection.query<RowDataPacket[]>("SELECT id FROM private_messages WHERE sender_application_user_id = ? AND recipient_application_user_id = ? LIMIT 1", [identity.userId, recipient.id]);
      if (pendingMessages.length) throw new Error("Your request is pending. Wait for the recipient to accept.");
    }
    const coinCost = paidMessagesToday < pricing.dailyPaidLimit ? pricing.coinCost : 0;
    if (Number(wallets[0].available_balance) < coinCost) throw new Error(`You need ${coinCost} coins to send this message.`);
    const messageId = randomUUID();
    const ledgerId = randomUUID();
    if (coinCost > 0) {
      await connection.execute("UPDATE wallet_balances SET available_balance = available_balance - ? WHERE id = ?", [coinCost, wallets[0].id]);
    }
    await connection.execute(
      `INSERT INTO ledger_transactions (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, source_id, destination_type, amount, status, reason)
       VALUES (?, ?, ?, 'COIN', ?, 'APPLICATION_USER', ?, 'SYSTEM', ?, 'COMPLETED', ?)`,
      [ledgerId, `MSG-${input.clientMessageId.replace(/-/g, "").slice(0, 20).toUpperCase()}`, `private-message:${identity.userId}:${input.clientMessageId}`,
        coinCost > 0 ? "PRIVATE_MESSAGE" : "PRIVATE_MESSAGE_FREE", identity.userId, coinCost,
        coinCost > 0 ? "Paid private message" : "Free private message after daily paid allowance"],
    );
    await connection.execute("INSERT INTO private_messages (id, client_message_id, sender_application_user_id, recipient_application_user_id, body, coin_cost, ledger_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?)", [messageId, input.clientMessageId, identity.userId, recipient.id, input.body, coinCost, ledgerId]);
    await connection.execute(
      `UPDATE private_message_daily_usage
       SET paid_message_count = paid_message_count + ?, total_message_count = total_message_count + 1
       WHERE application_user_id = ? AND usage_date = CURRENT_DATE`,
      [coinCost > 0 ? 1 : 0, identity.userId],
    );
    await connection.execute("UPDATE private_conversations SET updated_at = CURRENT_TIMESTAMP(3) WHERE user_low = ? AND user_high = ?", [low, high]);
    const nextPaidMessagesToday = paidMessagesToday + (coinCost > 0 ? 1 : 0);
    const nextTotalMessagesToday = totalMessagesToday + 1;
    const remainingPaidMessages = Math.max(0, pricing.dailyPaidLimit - nextPaidMessagesToday);
    return {
      id: messageId, coinCost,
      remainingCoins: Number(wallets[0].available_balance) - coinCost,
      paidMessagesToday: nextPaidMessagesToday,
      totalMessagesToday: nextTotalMessagesToday,
      remainingPaidMessages,
      nextMessageCoinCost: remainingPaidMessages > 0 ? pricing.coinCost : 0,
      serverDate: String(usage?.server_date ?? ""),
    };
  });
}

export async function respondToPrivateRequest(identity: MobileIdentity, input: { targetPublicId: string; accept: boolean }) {
  return withTransaction(async (connection) => {
    const [targets] = await connection.query<RowDataPacket[]>("SELECT id FROM application_users WHERE public_id = ? AND account_status = 'ACTIVE' LIMIT 1", [input.targetPublicId]);
    if (!targets[0] || targets[0].id === identity.userId) throw new Error("Request not found.");
    const [low, high] = [identity.userId, String(targets[0].id)].sort();
    const [result] = await connection.execute(
      "UPDATE private_conversations SET status = ? WHERE user_low = ? AND user_high = ? AND initiated_by = ? AND status = 'PENDING'",
      [input.accept ? "ACCEPTED" : "REJECTED", low, high, targets[0].id]);
    if ((result as { affectedRows: number }).affectedRows !== 1) throw new Error("Only the recipient can respond to a pending request.");
    return { accepted: input.accept };
  });
}

export async function setPrivateMessageBlock(identity: MobileIdentity, input: { targetPublicId: string; blocked: boolean }) {
  const [targets] = await db().query<(RowDataPacket & { id: string })[]>("SELECT id FROM application_users WHERE public_id = ? AND account_status = 'ACTIVE' LIMIT 1", [input.targetPublicId]);
  if (!targets[0] || targets[0].id === identity.userId) throw new Error("That user cannot be blocked.");
  if (input.blocked) await db().execute("INSERT IGNORE INTO private_message_blocks (blocker_application_user_id, blocked_application_user_id) VALUES (?, ?)", [identity.userId, targets[0].id]);
  else await db().execute("DELETE FROM private_message_blocks WHERE blocker_application_user_id = ? AND blocked_application_user_id = ?", [identity.userId, targets[0].id]);
  return { blocked: input.blocked };
}

export async function markPrivateConversationRead(identity: MobileIdentity, targetPublicId: string) {
  const [senders] = await db().query<(RowDataPacket & { id: string })[]>("SELECT id FROM application_users WHERE public_id = ? LIMIT 1", [targetPublicId]);
  if (!senders[0] || senders[0].id === identity.userId) throw new Error("That conversation is not available.");
  const [result] = await db().execute(
    `UPDATE private_messages SET read_at = CURRENT_TIMESTAMP(3)
     WHERE sender_application_user_id = ? AND recipient_application_user_id = ? AND read_at IS NULL`,
    [senders[0].id, identity.userId],
  );
  return { updated: Number((result as { affectedRows?: number }).affectedRows ?? 0) };
}

export async function reportPrivateMessage(identity: MobileIdentity, input: { messageId: string; reason: string }) {
  const [messages] = await db().query<(RowDataPacket & { recipient_application_user_id: string })[]>("SELECT recipient_application_user_id FROM private_messages WHERE id = ? LIMIT 1", [input.messageId]);
  if (!messages[0] || messages[0].recipient_application_user_id !== identity.userId) throw new Error("Only a received message can be reported.");
  await db().execute("INSERT INTO private_message_reports (message_id, reporter_application_user_id, reason) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE reason = VALUES(reason)", [input.messageId, identity.userId, input.reason]);
  return { reported: true };
}
