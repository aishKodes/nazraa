import "server-only";

import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { publicImageFromDataUrl } from "@/lib/security/public-images";

function imageDataUrl(value?: string) {
  if (!value) return null;
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("Agency logo must be a JPG, PNG, or WebP image.");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length < 1_000 || bytes.length > 1024 * 1024) {
    throw new Error("Agency logo must be between 1 KB and 1 MB.");
  }
  return { mimeType: match[1], bytes };
}

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
              approved.public_id agency_public_id, application.agency_name
       FROM agency_creation_applications application
       LEFT JOIN platform_accounts approved ON approved.id = application.approved_agency_account_id
       WHERE application.application_user_id = ? ORDER BY application.created_at DESC LIMIT 20`,
      [identity.userId],
    ),
    ]);
    return [
      ...joins[0].map((row) => ({ id: String(row.id), type: "join", status: String(row.status).toLowerCase(), agencyId: String(row.agency_public_id), agencyName: String(row.agency_name), reviewReason: row.review_reason, createdAt: row.created_at })),
      ...creations[0].map((row) => ({ id: String(row.id), type: "create", status: String(row.status).toLowerCase(), agencyId: row.agency_public_id == null ? null : String(row.agency_public_id), agencyName: String(row.agency_name), reviewReason: row.review_reason, createdAt: row.created_at })),
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
            COUNT(host.id) host_count
     FROM platform_accounts agency
     LEFT JOIN host_profiles host ON host.agency_account_id = agency.id AND host.status = 'ACTIVE'
     WHERE agency.public_id = ? AND agency.role = 'AGENCY' AND agency.status = 'ACTIVE'
     GROUP BY agency.id, agency.public_id, agency.full_name, agency.country_code, agency.status LIMIT 1`,
    [publicId],
  );
  const agency = rows[0];
  if (!agency) throw new Error("No active Agency was found with that six-digit ID.");
  return { id: String(agency.public_id), name: String(agency.full_name), country: agency.country_code ?? "", status: String(agency.status), hostCount: Number(agency.host_count) };
}

export async function applyToJoinAgency(identity: MobileIdentity, publicId: string) {
  return withTransaction(async (connection) => {
    const [users] = await connection.query<(RowDataPacket & { agency_account_id: string | null })[]>("SELECT agency_account_id FROM application_users WHERE id = ? LIMIT 1 FOR UPDATE", [identity.userId]);
    if (users[0]?.agency_account_id) throw new Error("Leave your current Agency before applying to another one.");
    const [agencies] = await connection.query<(RowDataPacket & { id: string; full_name: string })[]>("SELECT id, full_name FROM platform_accounts WHERE public_id = ? AND role = 'AGENCY' AND status = 'ACTIVE' LIMIT 1", [publicId]);
    if (!agencies[0]) throw new Error("No active Agency was found with that six-digit ID.");
    const [pending] = await connection.query<RowDataPacket[]>("SELECT id FROM agency_membership_applications WHERE application_user_id = ? AND status = 'PENDING' LIMIT 1", [identity.userId]);
    if (pending.length) throw new Error("You already have a pending Agency application.");
    await connection.execute("INSERT INTO agency_membership_applications (id, application_user_id, agency_account_id) VALUES (?, ?, ?)", [randomUUID(), identity.userId, agencies[0].id]);
    await connection.execute("INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'AGENCY', 'Agency application pending', ?, 'agency')", [randomUUID(), identity.userId, `Your request to join ${agencies[0].full_name} is waiting for approval.`]);
    return { status: "pending" };
  });
}

export async function applyToCreateAgency(identity: MobileIdentity, input: { name: string; countryCode: string; whatsappE164: string; logoDataUrl?: string }) {
  const logo = imageDataUrl(input.logoDataUrl);
  return withTransaction(async (connection) => {
    const [users] = await connection.query<(RowDataPacket & { agency_account_id: string | null })[]>("SELECT agency_account_id FROM application_users WHERE id = ? LIMIT 1 FOR UPDATE", [identity.userId]);
    if (users[0]?.agency_account_id) throw new Error("This account is already linked to an Agency.");
    const [pending] = await connection.query<RowDataPacket[]>("SELECT id FROM agency_creation_applications WHERE application_user_id = ? AND status = 'PENDING' LIMIT 1", [identity.userId]);
    if (pending.length) throw new Error("Your Agency creation application is already pending.");
    await connection.execute(
      `INSERT INTO agency_creation_applications
        (id, application_user_id, agency_name, country_code, business_whatsapp_e164, logo_mime_type, logo_data, logo_byte_size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), identity.userId, input.name, input.countryCode, input.whatsappE164, logo?.mimeType ?? null, logo?.bytes ?? null, logo?.bytes.length ?? null],
    );
    await connection.execute("INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'AGENCY', 'Agency creation pending', 'Nazraa operations received your Agency application.', 'agency')", [randomUUID(), identity.userId]);
    return { status: "pending" };
  });
}

export async function discoveryPosts() {
  try {
    const [rows] = await db().query<RowDataPacket[]>(
      `SELECT post.id, post.caption, post.status, post.created_at, asset.id asset_id,
              user.public_id, user.full_name, user.avatar_url, user.country_code,
              user.level_number, user.vip_tier, user.is_host
       FROM discovery_posts post
       INNER JOIN discovery_post_assets asset ON asset.id = post.asset_id
       INNER JOIN application_users user ON user.id = post.application_user_id
       WHERE post.status IN ('VISIBLE','UNDER_REVIEW')
       ORDER BY post.created_at DESC LIMIT 100`,
    );
    return rows.map((row) => ({
      id: String(row.id), type: "photo", caption: String(row.caption),
      mediaUrl: `https://nazraa.vercel.app/api/v1/assets/discovery/${row.asset_id}`,
      createdAt: row.created_at, moderationStatus: String(row.status).toLowerCase().replace("_", ""),
      author: { id: String(row.public_id), name: String(row.full_name), avatarUrl: row.avatar_url, country: row.country_code ?? "", level: Number(row.level_number), vip: Number(row.vip_tier), role: row.is_host ? "host" : "user" },
    }));
  } catch (error) {
    if ((error as { code?: string }).code === "ER_NO_SUCH_TABLE") return [];
    throw error;
  }
}

export async function createDiscoveryPost(identity: MobileIdentity, input: { caption: string; photoDataUrl: string }) {
  const image = publicImageFromDataUrl(input.photoDataUrl, 1536 * 1024, "Post photo");
  const assetId = randomUUID();
  const postId = randomUUID();
  await withTransaction(async (connection) => {
    await connection.execute("INSERT INTO discovery_post_assets (id, owner_application_user_id, mime_type, image_data, byte_size) VALUES (?, ?, ?, ?, ?)", [assetId, identity.userId, image.mimeType, image.data, image.byteSize]);
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

export async function privateMessagingForUser(identity: MobileIdentity) {
  try {
    const [messages, settingRows, blocks] = await Promise.all([
      db().query<RowDataPacket[]>(
        `SELECT message.id, message.client_message_id, sender.public_id sender_public_id,
                recipient.public_id recipient_public_id, message.body, message.coin_cost,
                message.read_at, message.created_at
         FROM private_messages message
         INNER JOIN application_users sender ON sender.id = message.sender_application_user_id
         INNER JOIN application_users recipient ON recipient.id = message.recipient_application_user_id
         WHERE message.sender_application_user_id = ? OR message.recipient_application_user_id = ?
         ORDER BY message.created_at DESC LIMIT 300`,
        [identity.userId, identity.userId],
      ),
      db().query<(RowDataPacket & { setting_value: unknown })[]>("SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.social' LIMIT 1"),
      db().query<RowDataPacket[]>(
        `SELECT blocked.public_id FROM private_message_blocks blocklist
         INNER JOIN application_users blocked ON blocked.id = blocklist.blocked_application_user_id
         WHERE blocklist.blocker_application_user_id = ?`,
        [identity.userId],
      ),
    ]);
    const setting = settingObject(settingRows[0][0]?.setting_value);
    return {
      coinCost: Math.max(0, Number(setting.private_message_coin_cost ?? 50)),
      blockedUserIds: blocks[0].map((row) => String(row.public_id)),
      messages: messages[0].map((row) => ({ id: String(row.id), clientMessageId: String(row.client_message_id), senderId: String(row.sender_public_id), recipientId: String(row.recipient_public_id), body: String(row.body), coinCost: Number(row.coin_cost), read: row.read_at != null, createdAt: row.created_at })),
    };
  } catch (error) {
    if ((error as { code?: string }).code === "ER_NO_SUCH_TABLE") return { coinCost: 50, blockedUserIds: [], messages: [] };
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
    const [settingRows] = await connection.query<(RowDataPacket & { setting_value: unknown })[]>("SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.social' LIMIT 1");
    const coinCost = Math.max(0, Number(settingObject(settingRows[0]?.setting_value).private_message_coin_cost ?? 50));
    await connection.execute("INSERT IGNORE INTO wallet_balances (id, owner_type, owner_id, asset_type) VALUES (?, 'APPLICATION_USER', ?, 'COIN')", [randomUUID(), identity.userId]);
    const [wallets] = await connection.query<(RowDataPacket & { id: string; available_balance: number })[]>("SELECT id, available_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' LIMIT 1 FOR UPDATE", [identity.userId]);
    const [existing] = await connection.query<(RowDataPacket & { id: string })[]>("SELECT id FROM private_messages WHERE sender_application_user_id = ? AND client_message_id = ? LIMIT 1", [identity.userId, input.clientMessageId]);
    if (existing[0]) return { id: existing[0].id, coinCost, alreadySent: true };
    if (Number(wallets[0].available_balance) < coinCost) throw new Error(`You need ${coinCost} coins to send this message.`);
    const messageId = randomUUID();
    const ledgerId = randomUUID();
    await connection.execute("UPDATE wallet_balances SET available_balance = available_balance - ? WHERE id = ?", [coinCost, wallets[0].id]);
    await connection.execute(
      `INSERT INTO ledger_transactions (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, source_id, destination_type, amount, status, reason)
       VALUES (?, ?, ?, 'COIN', 'PRIVATE_MESSAGE', 'APPLICATION_USER', ?, 'SYSTEM', ?, 'COMPLETED', 'Private message')`,
      [ledgerId, `MSG-${input.clientMessageId.replace(/-/g, "").slice(0, 20).toUpperCase()}`, `private-message:${identity.userId}:${input.clientMessageId}`, identity.userId, coinCost],
    );
    await connection.execute("INSERT INTO private_messages (id, client_message_id, sender_application_user_id, recipient_application_user_id, body, coin_cost, ledger_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?)", [messageId, input.clientMessageId, identity.userId, recipient.id, input.body, coinCost, ledgerId]);
    return { id: messageId, coinCost, remainingCoins: Number(wallets[0].available_balance) - coinCost };
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
