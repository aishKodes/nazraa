import "server-only";

import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { LiveAccessPolicyService } from "@/lib/services/live-access-policy";
import { FaceBiometricService } from "@/lib/services/face-biometric-service";
import { preparePrivateDocument } from "@/lib/security/documents";
import { agencyApplicationsForUser, discoveryPosts, privateMessagingForUser } from "@/lib/db/repositories/mobile-social";

function code(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

async function ensureWallet(connection: PoolConnection, userId: string, assetType: "COIN" | "DIAMOND") {
  await connection.execute(
    "INSERT IGNORE INTO wallet_balances (id, owner_type, owner_id, asset_type) VALUES (?, 'APPLICATION_USER', ?, ?)",
    [randomUUID(), userId, assetType],
  );
}

function avatarBytes(value?: string) {
  if (!value) return null;
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("Profile photo must be a JPG, PNG, or WebP image.");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length < 1_000 || bytes.length > 1024 * 1024) throw new Error("Profile photo must be between 1 KB and 1 MB.");
  return { mimeType: match[1], bytes };
}

export async function updateMobileProfile(identity: MobileIdentity, input: {
  displayName: string; bio: string; gender: "FEMALE" | "MALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY";
  countryCode: string; languageCode: string; whatsappE164: string; avatarDataUrl?: string;
}) {
  const avatar = avatarBytes(input.avatarDataUrl);
  await withTransaction(async (connection) => {
    await connection.execute(
      `UPDATE application_users SET full_name = ?, bio = ?, gender = ?, country_code = ?, language_code = ?, whatsapp_e164 = ?
       WHERE id = ?`,
      [input.displayName, input.bio, input.gender, input.countryCode, input.languageCode, input.whatsappE164, identity.userId],
    );
    if (avatar) {
      await connection.execute(
        `INSERT INTO application_user_avatars (application_user_id, mime_type, image_data, byte_size)
         VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE mime_type = VALUES(mime_type), image_data = VALUES(image_data), byte_size = VALUES(byte_size)`,
        [identity.userId, avatar.mimeType, avatar.bytes, avatar.bytes.length],
      );
      await connection.execute("UPDATE application_users SET avatar_url = NULL WHERE id = ?", [identity.userId]);
    }
  });
  return { updated: true };
}

export async function avatarForPublicId(publicId: string) {
  const [rows] = await db().query<(RowDataPacket & { mime_type: string; image_data: Buffer; updated_at: Date })[]>(
    `SELECT avatar.mime_type, avatar.image_data, avatar.updated_at
     FROM application_user_avatars avatar INNER JOIN application_users user ON user.id = avatar.application_user_id
     WHERE user.public_id = ? AND user.account_status = 'ACTIVE' LIMIT 1`,
    [publicId],
  );
  return rows[0] ?? null;
}

export async function claimDailyReward(identity: MobileIdentity) {
  return withTransaction(async (connection) => {
    const [clockRows] = await connection.query<(RowDataPacket & { today: string })[]>("SELECT CURRENT_DATE today");
    const today = String(clockRows[0].today);
    const [lastRows] = await connection.query<(RowDataPacket & { claim_date: string; streak_day: number })[]>(
      "SELECT claim_date, streak_day FROM daily_reward_claims WHERE application_user_id = ? ORDER BY claim_date DESC LIMIT 1 FOR UPDATE",
      [identity.userId],
    );
    const last = lastRows[0];
    if (last && String(last.claim_date).slice(0, 10) === today.slice(0, 10)) throw new Error("Today's reward is already claimed.");
    let daysSinceLast = 0;
    if (last) {
      const [diffRows] = await connection.query<(RowDataPacket & { days: number })[]>(
        "SELECT DATEDIFF(CURRENT_DATE, ?) days",
        [last.claim_date],
      );
      daysSinceLast = Number(diffRows[0]?.days ?? 0);
    }
    const streak = last && daysSinceLast === 1 ? Number(last.streak_day) + 1 : 1;
    const [countRows] = await connection.query<(RowDataPacket & { count: number })[]>("SELECT COUNT(*) count FROM daily_reward_rules WHERE enabled = TRUE");
    const cycleLength = Math.max(1, Number(countRows[0].count));
    const dayNumber = ((streak - 1) % cycleLength) + 1;
    const [ruleRows] = await connection.query<(RowDataPacket & { reward_coins: number; label: string })[]>(
      "SELECT reward_coins, label FROM daily_reward_rules WHERE day_number = ? AND enabled = TRUE LIMIT 1",
      [dayNumber],
    );
    const rule = ruleRows[0];
    if (!rule) throw new Error("Daily rewards are temporarily unavailable.");
    await ensureWallet(connection, identity.userId, "COIN");
    const [walletRows] = await connection.query<(RowDataPacket & { id: string; available_balance: number })[]>(
      "SELECT id, available_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' FOR UPDATE",
      [identity.userId],
    );
    const wallet = walletRows[0];
    const transactionId = randomUUID();
    const claimCode = code("DAY");
    await connection.execute("UPDATE wallet_balances SET available_balance = available_balance + ? WHERE id = ?", [rule.reward_coins, wallet.id]);
    await connection.execute(
      `INSERT INTO ledger_transactions
        (id, transaction_code, asset_type, transaction_type, source_type, destination_type, destination_id, amount, status, reason)
       VALUES (?, ?, 'COIN', 'DAILY_REWARD', 'SYSTEM', 'APPLICATION_USER', ?, ?, 'COMPLETED', ?)`,
      [transactionId, claimCode, identity.userId, rule.reward_coins, `${rule.label} • streak ${streak}`],
    );
    await connection.execute(
      "INSERT INTO daily_reward_claims (id, claim_code, application_user_id, claim_date, streak_day, reward_coins, ledger_transaction_id) VALUES (?, ?, ?, CURRENT_DATE, ?, ?, ?)",
      [randomUUID(), claimCode, identity.userId, streak, rule.reward_coins, transactionId],
    );
    await connection.execute(
      "INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'DAILY_REWARD', 'Daily reward claimed', ?, 'daily-rewards')",
      [randomUUID(), identity.userId, `${rule.reward_coins} coins added. Streak day ${streak}.`],
    );
    return { transactionId: claimCode, rewardCoins: Number(rule.reward_coins), streak, dayNumber, newBalance: Number(wallet.available_balance) + Number(rule.reward_coins) };
  });
}

export async function exchangeDiamonds(identity: MobileIdentity, diamonds: number) {
  return withTransaction(async (connection) => {
    const [ruleRows] = await connection.query<(RowDataPacket & { id: string; diamonds: number; coins: number; minimum_diamonds: number; maximum_diamonds: number })[]>(
      `SELECT id, diamonds, coins, minimum_diamonds, maximum_diamonds FROM diamond_conversion_rules
       WHERE enabled = TRUE AND effective_from <= CURRENT_TIMESTAMP(3) ORDER BY effective_from DESC LIMIT 1 FOR UPDATE`,
    );
    const rule = ruleRows[0];
    if (!rule) throw new Error("Diamond exchange is not available.");
    if (!Number.isSafeInteger(diamonds) || diamonds < Number(rule.minimum_diamonds) || diamonds > Number(rule.maximum_diamonds) || diamonds % Number(rule.diamonds) !== 0) {
      throw new Error(`Exchange ${rule.minimum_diamonds}–${rule.maximum_diamonds} diamonds in steps of ${rule.diamonds}.`);
    }
    const coins = Math.floor(diamonds / Number(rule.diamonds)) * Number(rule.coins);
    await ensureWallet(connection, identity.userId, "DIAMOND");
    await ensureWallet(connection, identity.userId, "COIN");
    const [walletRows] = await connection.query<(RowDataPacket & { id: string; asset_type: string; available_balance: number })[]>(
      "SELECT id, asset_type, available_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type IN ('COIN','DIAMOND') ORDER BY asset_type FOR UPDATE",
      [identity.userId],
    );
    const diamondWallet = walletRows.find((row) => row.asset_type === "DIAMOND");
    const coinWallet = walletRows.find((row) => row.asset_type === "COIN");
    if (!diamondWallet || !coinWallet || Number(diamondWallet.available_balance) < diamonds) throw new Error("Available diamonds are too low for this exchange.");
    const exchangeId = randomUUID(); const exchangeCode = code("EXC");
    const diamondLedgerId = randomUUID(); const coinLedgerId = randomUUID();
    await connection.execute("UPDATE wallet_balances SET available_balance = available_balance - ? WHERE id = ?", [diamonds, diamondWallet.id]);
    await connection.execute("UPDATE wallet_balances SET available_balance = available_balance + ? WHERE id = ?", [coins, coinWallet.id]);
    await connection.execute(
      `INSERT INTO ledger_transactions
        (id, transaction_code, asset_type, transaction_type, source_type, source_id, destination_type, amount, status, reason)
       VALUES (?, ?, 'DIAMOND', 'DIAMOND_EXCHANGE_DEBIT', 'APPLICATION_USER', ?, 'SYSTEM', ?, 'COMPLETED', ?)`,
      [diamondLedgerId, `${exchangeCode}-D`, identity.userId, diamonds, `${diamonds} diamonds exchanged`],
    );
    await connection.execute(
      `INSERT INTO ledger_transactions
        (id, transaction_code, asset_type, transaction_type, source_type, destination_type, destination_id, amount, status, reason)
       VALUES (?, ?, 'COIN', 'DIAMOND_EXCHANGE_CREDIT', 'SYSTEM', 'APPLICATION_USER', ?, ?, 'COMPLETED', ?)`,
      [coinLedgerId, `${exchangeCode}-C`, identity.userId, coins, `${diamonds} diamonds → ${coins} coins`],
    );
    await connection.execute(
      `INSERT INTO diamond_coin_exchanges
        (id, exchange_code, application_user_id, rule_id, diamonds_debited, coins_credited,
         diamond_before, diamond_after, coin_before, coin_after, diamond_ledger_id, coin_ledger_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [exchangeId, exchangeCode, identity.userId, rule.id, diamonds, coins,
        diamondWallet.available_balance, Number(diamondWallet.available_balance) - diamonds,
        coinWallet.available_balance, Number(coinWallet.available_balance) + coins, diamondLedgerId, coinLedgerId],
    );
    return { transactionId: exchangeCode, diamonds, coins, diamondBalance: Number(diamondWallet.available_balance) - diamonds, coinBalance: Number(coinWallet.available_balance) + coins };
  });
}

export async function joinLiveRoom(identity: MobileIdentity, roomCode: string, password?: string) {
  const access = LiveAccessPolicyService.for(identity).join;
  if (!access.allowed) throw new Error(access.reason);
  return withTransaction(async (connection) => {
    const [rooms] = await connection.query<(RowDataPacket & { id: string; room_type: "LIVE" | "PARTY" | "FACE"; host_application_user_id: string; password_hash: string | null })[]>(
      "SELECT id, room_type, host_application_user_id, password_hash FROM live_rooms WHERE room_code = ? AND status IN ('ACTIVE','LOCKED') LIMIT 1 FOR UPDATE",
      [roomCode],
    );
    const room = rooms[0];
    if (!room) throw new Error("This room is no longer active.");
    if (room.host_application_user_id !== identity.userId && room.password_hash) {
      if (!password || !(await bcrypt.compare(password, room.password_hash))) {
        throw new Error("The room password is incorrect.");
      }
    }
    const interactionAllowed = LiveAccessPolicyService.for(identity).chat.allowed;
    const requestedRole = room.host_application_user_id === identity.userId
      ? "OWNER"
      : room.room_type === "PARTY" && interactionAllowed ? "SPEAKER" : "AUDIENCE";
    await connection.execute(
      `INSERT INTO live_room_members (room_id, application_user_id, room_role, muted, left_at)
       VALUES (?, ?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE room_role = IF(room_role IN ('OWNER','ADMIN'), room_role, VALUES(room_role)), muted = VALUES(muted), left_at = NULL`,
      [room.id, identity.userId, requestedRole, requestedRole === "AUDIENCE"],
    );
    await connection.execute(
      `UPDATE live_rooms SET audience_count = (
         SELECT COUNT(*) FROM live_room_members WHERE room_id = ? AND left_at IS NULL
       ) WHERE id = ?`,
      [room.id, room.id],
    );
    const [members] = await connection.query<(RowDataPacket & { room_role: string })[]>(
      "SELECT room_role FROM live_room_members WHERE room_id = ? AND application_user_id = ? LIMIT 1",
      [room.id, identity.userId],
    );
    return { role: String(members[0].room_role).toLowerCase() };
  });
}

export async function leaveLiveRoom(identity: MobileIdentity, roomCode: string) {
  return withTransaction(async (connection) => {
    const [rooms] = await connection.query<(RowDataPacket & { id: string; host_application_user_id: string })[]>(
      "SELECT id, host_application_user_id FROM live_rooms WHERE room_code = ? AND status IN ('ACTIVE','LOCKED') LIMIT 1 FOR UPDATE",
      [roomCode],
    );
    const room = rooms[0];
    if (!room) return { left: true };
    if (room.host_application_user_id === identity.userId) throw new Error("The room owner must end the room.");
    await connection.execute(
      "UPDATE live_room_members SET left_at = CURRENT_TIMESTAMP(3), muted = TRUE WHERE room_id = ? AND application_user_id = ?",
      [room.id, identity.userId],
    );
    await connection.execute(
      `UPDATE live_rooms SET audience_count = (
         SELECT COUNT(*) FROM live_room_members WHERE room_id = ? AND left_at IS NULL
       ) WHERE id = ?`,
      [room.id, room.id],
    );
    return { left: true };
  });
}

export async function roomPublishingDecision(identity: MobileIdentity, roomCode: string) {
  const [rooms] = await db().query<(RowDataPacket & { id: string; room_type: "LIVE" | "PARTY" | "FACE"; host_application_user_id: string })[]>(
    "SELECT id, room_type, host_application_user_id FROM live_rooms WHERE room_code = ? AND status IN ('ACTIVE','LOCKED') LIMIT 1",
    [roomCode],
  );
  const room = rooms[0];
  if (!room) throw new Error("This room is no longer active.");
  const policy = LiveAccessPolicyService.for(identity);
  if (room.room_type === "PARTY") {
    if (!policy.chat.allowed) throw new Error(policy.chat.reason);
    const [members] = await db().query<(RowDataPacket & { room_role: string })[]>(
      "SELECT room_role FROM live_room_members WHERE room_id = ? AND application_user_id = ? AND left_at IS NULL LIMIT 1",
      [room.id, identity.userId],
    );
    if (!members[0] || !["OWNER", "ADMIN", "SPEAKER"].includes(String(members[0].room_role))) {
      throw new Error("An active Party speaker role is required to publish audio.");
    }
    return policy.chat;
  }
  if (room.host_application_user_id !== identity.userId) throw new Error("Only the room owner can publish a Live stream.");
  const access = room.room_type === "FACE" ? policy.face : policy.video;
  if (!access.allowed) throw new Error(access.reason);
  return access;
}

export async function setRoomAdmin(identity: MobileIdentity, input: { roomCode: string; targetPublicId: string; makeAdmin: boolean }) {
  return withTransaction(async (connection) => {
    const [rooms] = await connection.query<(RowDataPacket & { id: string; room_type: string; host_application_user_id: string })[]>(
      "SELECT id, room_type, host_application_user_id FROM live_rooms WHERE room_code = ? AND status IN ('ACTIVE','LOCKED') LIMIT 1 FOR UPDATE",
      [input.roomCode],
    );
    const room = rooms[0];
    if (!room || room.host_application_user_id !== identity.userId) throw new Error("Only the room owner can appoint Room Admins.");
    if (room.room_type !== "PARTY") throw new Error("Room Admins are available only in Party Rooms.");
    const [targets] = await connection.query<(RowDataPacket & { id: string })[]>(
      `SELECT user.id FROM live_room_members member
       INNER JOIN application_users user ON user.id = member.application_user_id
       WHERE member.room_id = ? AND member.left_at IS NULL AND user.public_id = ?
         AND user.account_status = 'ACTIVE' LIMIT 1`,
      [room.id, input.targetPublicId],
    );
    const target = targets[0];
    if (!target || target.id === identity.userId) throw new Error("Choose another active room member.");
    if (input.makeAdmin) {
      const [countRows] = await connection.query<(RowDataPacket & { count: number })[]>(
        "SELECT COUNT(*) count FROM live_room_members WHERE room_id = ? AND room_role = 'ADMIN' AND left_at IS NULL FOR UPDATE",
        [room.id],
      );
      if (Number(countRows[0].count) >= 3) throw new Error("A Party Room can have at most three Room Admins.");
      await connection.execute(
        `INSERT INTO live_room_members (room_id, application_user_id, room_role, muted, left_at)
         VALUES (?, ?, 'ADMIN', TRUE, NULL)
         ON DUPLICATE KEY UPDATE room_role = 'ADMIN', left_at = NULL`,
        [room.id, target.id],
      );
    } else {
      await connection.execute("UPDATE live_room_members SET room_role = 'AUDIENCE' WHERE room_id = ? AND application_user_id = ? AND room_role = 'ADMIN'", [room.id, target.id]);
    }
    await connection.execute(
      `INSERT INTO audit_logs
        (id, actor_role, action, module, target_type, target_id, new_data, reason)
       VALUES (?, 'HOST', ?, 'PARTY_ROOM', 'LIVE_ROOM', ?, JSON_OBJECT('targetPublicId', ?, 'roomRole', ?), ?)`,
      [randomUUID(), input.makeAdmin ? "ROOM_ADMIN_APPOINTED" : "ROOM_ADMIN_REMOVED", room.id,
        input.targetPublicId, input.makeAdmin ? "ADMIN" : "AUDIENCE",
        input.makeAdmin ? "Room owner appointed an active room member." : "Room owner removed a Room Admin."],
    );
    const [admins] = await connection.query<(RowDataPacket & { public_id: number })[]>(
      `SELECT user.public_id FROM live_room_members member INNER JOIN application_users user ON user.id = member.application_user_id
       WHERE member.room_id = ? AND member.room_role = 'ADMIN' AND member.left_at IS NULL ORDER BY member.updated_at`,
      [room.id],
    );
    return { admins: admins.map((row) => String(row.public_id)), limit: 3 };
  });
}

export async function setRoomMemberMuted(identity: MobileIdentity, input: { roomCode: string; targetPublicId: string; muted: boolean }) {
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { room_id: string; actor_role: string; target_id: string; target_role: string })[]>(
      `SELECT room.id room_id, actor.room_role actor_role,
              target.application_user_id target_id, target.room_role target_role
       FROM live_rooms room
       INNER JOIN live_room_members actor ON actor.room_id = room.id
         AND actor.application_user_id = ? AND actor.left_at IS NULL
       INNER JOIN live_room_members target ON target.room_id = room.id AND target.left_at IS NULL
       INNER JOIN application_users target_user ON target_user.id = target.application_user_id
       WHERE room.room_code = ? AND room.room_type = 'PARTY'
         AND room.status IN ('ACTIVE','LOCKED') AND target_user.public_id = ?
       LIMIT 1 FOR UPDATE`,
      [identity.userId, input.roomCode, input.targetPublicId],
    );
    const member = rows[0];
    if (!member || !["OWNER", "ADMIN"].includes(member.actor_role)) {
      throw new Error("Only the Room Owner or a Room Admin can manage microphones.");
    }
    if (member.target_id === identity.userId || member.target_role === "OWNER") {
      throw new Error("The Room Owner microphone is controlled on the owner device.");
    }
    if (member.actor_role === "ADMIN" && member.target_role === "ADMIN") {
      throw new Error("Only the Room Owner can manage another Room Admin microphone.");
    }
    await connection.execute(
      "UPDATE live_room_members SET muted = ? WHERE room_id = ? AND application_user_id = ?",
      [input.muted, member.room_id, member.target_id],
    );
    await connection.execute(
      `INSERT INTO audit_logs
        (id, actor_role, action, module, target_type, target_id, new_data, reason)
       VALUES (?, ?, ?, 'PARTY_ROOM', 'APPLICATION_USER', ?,
         JSON_OBJECT('roomCode', ?, 'muted', ?), 'Authorized in-room microphone moderation.')`,
      [randomUUID(), member.actor_role, input.muted ? "ROOM_MEMBER_MUTED" : "ROOM_MEMBER_UNMUTE_REQUESTED",
        member.target_id, input.roomCode, input.muted],
    );
    return { muted: input.muted, targetPublicId: input.targetPublicId };
  });
}

export async function sendRoomInteraction(identity: MobileIdentity, input: { roomCode: string; targetPublicId: string; interactionKey: string }) {
  return withTransaction(async (connection) => {
    const [settingRows] = await connection.query<(RowDataPacket & { setting_value: unknown })[]>(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.room_features' LIMIT 1",
    );
    const raw = settingRows[0]?.setting_value;
    const settings = typeof raw === "string" ? JSON.parse(raw) as { interactions?: { key?: string; enabled?: boolean }[] } : raw as { interactions?: { key?: string; enabled?: boolean }[] } | undefined;
    const allowed = new Set((settings?.interactions ?? []).filter((item) => item.enabled !== false).map((item) => item.key).filter(Boolean));
    if (!allowed.has(input.interactionKey)) throw new Error("That room interaction is not available.");

    const [rows] = await connection.query<(RowDataPacket & { room_id: string; target_id: string })[]>(
      `SELECT room.id room_id, target.application_user_id target_id
       FROM live_rooms room
       INNER JOIN live_room_members sender ON sender.room_id = room.id
         AND sender.application_user_id = ? AND sender.left_at IS NULL
       INNER JOIN live_room_members target ON target.room_id = room.id AND target.left_at IS NULL
       INNER JOIN application_users target_user ON target_user.id = target.application_user_id
       WHERE room.room_code = ? AND room.status IN ('ACTIVE','LOCKED')
         AND target_user.public_id = ? LIMIT 1 FOR UPDATE`,
      [identity.userId, input.roomCode, input.targetPublicId],
    );
    const member = rows[0];
    if (!member) throw new Error("Both users must be active in the same room.");
    if (member.target_id === identity.userId) throw new Error("Choose another room member.");
    const id = randomUUID();
    await connection.execute(
      `INSERT INTO room_interaction_events
        (id, room_id, sender_application_user_id, target_application_user_id, interaction_key)
       VALUES (?, ?, ?, ?, ?)`,
      [id, member.room_id, identity.userId, member.target_id, input.interactionKey],
    );
    return { id, interactionKey: input.interactionKey, targetPublicId: input.targetPublicId, createdAt: new Date().toISOString() };
  });
}

export async function createPkSession(identity: MobileIdentity, input: { sourceRoomCode: string; targetRoomCode: string; mode: string; durationMinutes: number }) {
  return withTransaction(async (connection) => {
    const [settingRows] = await connection.query<(RowDataPacket & { setting_value: unknown })[]>(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.room_features' LIMIT 1",
    );
    const raw = settingRows[0]?.setting_value;
    const settings = typeof raw === "string" ? JSON.parse(raw) as { pkModes?: string[]; pkDurations?: number[] } : raw as { pkModes?: string[]; pkDurations?: number[] } | undefined;
    if (!(settings?.pkModes ?? []).includes(input.mode) || !(settings?.pkDurations ?? []).map(Number).includes(input.durationMinutes)) {
      throw new Error("That PK rule is not currently available.");
    }
    const [rooms] = await connection.query<(RowDataPacket & { source_id: string; source_host_id: string; source_type: string; source_pk_enabled: number; target_id: string; target_type: string; target_pk_enabled: number })[]>(
      `SELECT source.id source_id, source.host_application_user_id source_host_id, source.room_type source_type,
              source.pk_requests_enabled source_pk_enabled,
              target.id target_id, target.room_type target_type, target.pk_requests_enabled target_pk_enabled
       FROM live_rooms source INNER JOIN live_rooms target ON target.room_code = ?
       WHERE source.room_code = ? AND source.status IN ('ACTIVE','LOCKED')
         AND target.status IN ('ACTIVE','LOCKED') LIMIT 1 FOR UPDATE`,
      [input.targetRoomCode, input.sourceRoomCode],
    );
    const roomsPair = rooms[0];
    if (!roomsPair || roomsPair.source_host_id !== identity.userId) throw new Error("Only the active source room host can request PK.");
    if (!roomsPair.source_pk_enabled || !roomsPair.target_pk_enabled) throw new Error("PK requests are disabled in one of these rooms.");
    if (roomsPair.source_id === roomsPair.target_id) throw new Error("Choose another Live room.");
    if (!["LIVE", "FACE"].includes(roomsPair.source_type) || !["LIVE", "FACE"].includes(roomsPair.target_type)) {
      throw new Error("PK is available only between Video Live or Face Live rooms.");
    }
    const id = randomUUID();
    await connection.execute(
      `INSERT INTO live_pk_sessions
        (id, source_room_id, target_room_id, requested_by_application_user_id, mode, duration_minutes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, roomsPair.source_id, roomsPair.target_id, identity.userId, input.mode, input.durationMinutes],
    );
    return { id, status: "requested", mode: input.mode, durationMinutes: input.durationMinutes };
  });
}

export async function closePkSession(identity: MobileIdentity, input: { sessionId: string; completed: boolean }) {
  const [result] = await db().execute(
    `UPDATE live_pk_sessions session
     INNER JOIN live_rooms room ON room.id = session.source_room_id
     SET session.status = ?, session.ended_at = CURRENT_TIMESTAMP(3)
     WHERE session.id = ? AND room.host_application_user_id = ?
       AND session.status IN ('REQUESTED','ACTIVE')`,
    [input.completed ? "COMPLETED" : "CANCELLED", input.sessionId, identity.userId],
  );
  if ((result as { affectedRows?: number }).affectedRows !== 1) throw new Error("The PK session could not be closed.");
  return { id: input.sessionId, status: input.completed ? "completed" : "cancelled" };
}

export async function recordFacePresenceAutoStop(
  identity: MobileIdentity,
  input: { roomCode: string; consecutiveFailures: number },
) {
  return withTransaction(async (connection) => {
    const [rooms] = await connection.query<(RowDataPacket & { id: string })[]>(
      `SELECT id FROM live_rooms
       WHERE room_code = ? AND host_application_user_id = ? AND room_type IN ('LIVE','FACE')
         AND status IN ('ACTIVE','LOCKED') LIMIT 1 FOR UPDATE`,
      [input.roomCode, identity.userId],
    );
    const room = rooms[0];
    if (!room) throw new Error("Only the active Face Live host can report a presence stop.");

    const [settingRows] = await connection.query<(RowDataPacket & { setting_value: unknown })[]>(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.room_features' LIMIT 1",
    );
    const raw = settingRows[0]?.setting_value;
    const settings = typeof raw === "string"
      ? JSON.parse(raw) as { presenceSuspensionLimit?: number }
      : raw as { presenceSuspensionLimit?: number } | undefined;
    const suspensionLimit = Math.min(20, Math.max(1, Number(settings?.presenceSuspensionLimit ?? 5)));

    await connection.execute(
      `INSERT INTO face_live_presence_incidents
        (id, room_id, host_application_user_id, incident_type, consecutive_failures, evidence_metadata)
       VALUES (?, ?, ?, 'LIVE_AUTO_STOPPED', ?, JSON_OBJECT(
         'detector', 'google_mlkit_face_detection',
         'processing', 'on_device',
         'imageRetained', FALSE
       ))`,
      [randomUUID(), room.id, identity.userId, input.consecutiveFailures],
    );
    const [countRows] = await connection.query<(RowDataPacket & { count: number })[]>(
      `SELECT COUNT(*) count FROM face_live_presence_incidents
       WHERE host_application_user_id = ? AND incident_type = 'LIVE_AUTO_STOPPED'
         AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)`,
      [identity.userId],
    );
    const autoStopCount = Number(countRows[0]?.count ?? 0);
    let suspended = false;
    if (autoStopCount >= suspensionLimit) {
      const [activeRows] = await connection.query<RowDataPacket[]>(
        `SELECT id FROM moderation_restrictions
         WHERE application_user_id = ? AND restriction_type IN ('TEMP_LIVE_BAN','SUSPENSION')
           AND status = 'ACTIVE' AND (ends_at IS NULL OR ends_at > CURRENT_TIMESTAMP(3))
         LIMIT 1 FOR UPDATE`,
        [identity.userId],
      );
      if (!activeRows[0]) {
        const [masterRows] = await connection.query<(RowDataPacket & { id: string })[]>(
          "SELECT id FROM platform_accounts WHERE role = 'MASTER' AND status = 'ACTIVE' ORDER BY created_at LIMIT 1",
        );
        if (!masterRows[0]) throw new Error("Master moderation account is unavailable.");
        await connection.execute(
          `INSERT INTO moderation_restrictions
            (id, application_user_id, restriction_type, ends_at, reason, actor_account_id)
           VALUES (?, ?, 'SUSPENSION', NULL, ?, ?)`,
          [randomUUID(), identity.userId,
            `Automatic Face Live presence protection: ${autoStopCount} stopped sessions within 24 hours.`,
            masterRows[0].id],
        );
        await connection.execute(
          `INSERT INTO mobile_notifications
            (id, application_user_id, notification_type, title, message, action_target)
           VALUES (?, ?, 'MODERATION', 'Live access suspended',
             'Repeated camera-presence stops triggered a Live suspension pending staff review.', 'profile/live-access')`,
          [randomUUID(), identity.userId],
        );
      }
      suspended = true;
    }
    await connection.execute(
      `INSERT INTO audit_logs
        (id, actor_role, action, module, target_type, target_id, new_data, reason)
       VALUES (?, 'HOST', 'FACE_LIVE_PRESENCE_AUTO_STOP', 'FACE_LIVE', 'LIVE_ROOM', ?,
         JSON_OBJECT('consecutiveFailures', ?, 'autoStopCount24h', ?, 'suspended', ?),
         'On-device face presence limit reached; no image was uploaded or retained.')`,
      [randomUUID(), room.id, input.consecutiveFailures, autoStopCount, suspended],
    );
    return { suspended, autoStopCount, suspensionLimit };
  });
}

export async function updateRoomSettings(identity: MobileIdentity, input: { roomCode: string; themeIndex?: number; themeEnabled?: boolean; pkRequestsEnabled?: boolean; chatLocked?: boolean; password?: string; removePassword: boolean; topPublicId?: string; resetTopDp: boolean }) {
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { room_id: string; actor_role: string; theme_index: number; theme_enabled: number; pk_requests_enabled: number; chat_locked: number; password_hash: string | null; password_length: number | null; top_application_user_id: string | null })[]>(
      `SELECT room.id room_id, member.room_role actor_role, room.theme_index, room.chat_locked,
              room.password_hash, room.password_length, room.theme_enabled, room.pk_requests_enabled, room.top_application_user_id
       FROM live_rooms room INNER JOIN live_room_members member ON member.room_id = room.id
         AND member.application_user_id = ? AND member.left_at IS NULL
       WHERE room.room_code = ? AND room.status IN ('ACTIVE','LOCKED') LIMIT 1 FOR UPDATE`,
      [identity.userId, input.roomCode],
    );
    const room = rows[0];
    if (!room || !["OWNER", "ADMIN"].includes(room.actor_role)) throw new Error("Only the Room Owner or a Room Admin can update room tools.");
    if ((input.password != null || input.removePassword) && room.actor_role !== "OWNER") throw new Error("Only the Room Owner can change the room password.");
    if (input.password != null && !/^(\d{4}|\d{6}|\d{10})$/.test(input.password)) throw new Error("Use a 4, 6, or 10 digit room password.");
    const passwordHash = input.removePassword ? null : input.password ? await bcrypt.hash(input.password, 10) : room.password_hash;
    const passwordLength = input.removePassword ? null : input.password ? input.password.length : room.password_length;
    let topUserId = input.resetTopDp ? null : room.top_application_user_id;
    if (input.topPublicId) {
      const [topRows] = await connection.query<(RowDataPacket & { id: string })[]>(
        `SELECT user.id FROM live_room_members member
         INNER JOIN application_users user ON user.id = member.application_user_id
         WHERE member.room_id = ? AND member.left_at IS NULL AND user.public_id = ?
           AND user.account_status = 'ACTIVE' LIMIT 1`,
        [room.room_id, input.topPublicId],
      );
      if (!topRows[0]) throw new Error("Top DP must be an active member of this room.");
      topUserId = topRows[0].id;
    }
    await connection.execute(
      `UPDATE live_rooms SET theme_index = ?, theme_enabled = ?, pk_requests_enabled = ?, chat_locked = ?, password_hash = ?, password_length = ?, top_application_user_id = ?,
         privacy = IF(? IS NULL, IF(privacy = 'LOCKED', 'PUBLIC', privacy), 'LOCKED')
       WHERE id = ?`,
      [input.themeIndex ?? Number(room.theme_index), input.themeEnabled ?? Boolean(room.theme_enabled), input.pkRequestsEnabled ?? Boolean(room.pk_requests_enabled), input.chatLocked ?? Boolean(room.chat_locked), passwordHash, passwordLength, topUserId,
        passwordHash, room.room_id],
    );
    return { themeIndex: input.themeIndex ?? Number(room.theme_index), themeEnabled: input.themeEnabled ?? Boolean(room.theme_enabled), pkRequestsEnabled: input.pkRequestsEnabled ?? Boolean(room.pk_requests_enabled), chatLocked: input.chatLocked ?? Boolean(room.chat_locked), passwordRequired: passwordHash != null, topPublicId: input.topPublicId ?? null };
  });
}

export async function sendRoomChat(identity: MobileIdentity, input: { roomCode: string; body: string }) {
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { room_id: string; room_role: string; chat_locked: number })[]>(
      `SELECT room.id room_id, member.room_role, room.chat_locked
       FROM live_rooms room INNER JOIN live_room_members member ON member.room_id = room.id
         AND member.application_user_id = ? AND member.left_at IS NULL
       WHERE room.room_code = ? AND room.status IN ('ACTIVE','LOCKED') LIMIT 1`,
      [identity.userId, input.roomCode],
    );
    const room = rows[0];
    if (!room) throw new Error("Join the room before sending chat.");
    if (room.chat_locked && !["OWNER", "ADMIN"].includes(room.room_role)) throw new Error("Room chat is locked by the room staff.");
    const id = randomUUID();
    await connection.execute(
      "INSERT INTO live_room_messages (id, room_id, sender_application_user_id, body) VALUES (?, ?, ?, ?)",
      [id, room.room_id, identity.userId, input.body],
    );
    return { id, createdAt: new Date().toISOString() };
  });
}

export async function clearRoomChat(identity: MobileIdentity, roomCode: string) {
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { room_id: string; room_role: string })[]>(
      `SELECT room.id room_id, member.room_role FROM live_rooms room
       INNER JOIN live_room_members member ON member.room_id = room.id
         AND member.application_user_id = ? AND member.left_at IS NULL
       WHERE room.room_code = ? AND room.status IN ('ACTIVE','LOCKED') LIMIT 1 FOR UPDATE`,
      [identity.userId, roomCode],
    );
    const room = rows[0];
    if (!room || !["OWNER", "ADMIN"].includes(room.room_role)) throw new Error("Only the Room Owner or a Room Admin can clear chat.");
    const [result] = await connection.execute(
      "UPDATE live_room_messages SET visible = FALSE, cleared_by_application_user_id = ?, cleared_at = CURRENT_TIMESTAMP(3) WHERE room_id = ? AND visible = TRUE",
      [identity.userId, room.room_id],
    );
    return { cleared: (result as { affectedRows?: number }).affectedRows ?? 0 };
  });
}

export async function kickRoomMember(identity: MobileIdentity, input: { roomCode: string; targetPublicId: string }) {
  return withTransaction(async (connection) => {
    const [actors] = await connection.query<(RowDataPacket & { room_id: string; actor_role: string; target_id: string; target_role: string })[]>(
      `SELECT room.id room_id, actor.room_role actor_role, target.application_user_id target_id, target.room_role target_role
       FROM live_rooms room
       INNER JOIN live_room_members actor ON actor.room_id = room.id
         AND actor.application_user_id = ? AND actor.left_at IS NULL
       INNER JOIN live_room_members target ON target.room_id = room.id AND target.left_at IS NULL
       INNER JOIN application_users target_user ON target_user.id = target.application_user_id
       WHERE room.room_code = ? AND room.status IN ('ACTIVE','LOCKED')
         AND target_user.public_id = ? LIMIT 1 FOR UPDATE`,
      [identity.userId, input.roomCode, input.targetPublicId],
    );
    const member = actors[0];
    if (!member || !["OWNER", "ADMIN"].includes(member.actor_role)) {
      throw new Error("Only the Room Owner or a Room Admin can kick users.");
    }
    if (member.target_id === identity.userId || member.target_role === "OWNER") {
      throw new Error("The Room Owner cannot be kicked.");
    }
    if (member.actor_role === "ADMIN" && member.target_role === "ADMIN") {
      throw new Error("Only the Room Owner can remove another Room Admin.");
    }
    await connection.execute(
      "UPDATE live_room_members SET left_at = CURRENT_TIMESTAMP(3), muted = TRUE WHERE room_id = ? AND application_user_id = ?",
      [member.room_id, member.target_id],
    );
    await connection.execute(
      `INSERT INTO audit_logs
        (id, actor_role, action, module, target_type, target_id, new_data, reason)
       VALUES (?, ?, 'ROOM_MEMBER_KICKED', 'PARTY_ROOM', 'APPLICATION_USER', ?, JSON_OBJECT('roomCode', ?), 'Authorized in-room moderation action.')`,
      [randomUUID(), member.actor_role, member.target_id, input.roomCode],
    );
    return { kicked: true, targetPublicId: input.targetPublicId };
  });
}

export async function finalizeLiveSession(identity: MobileIdentity, roomCode: string) {
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & {
      accounting_id: string; room_id: string; room_type: "LIVE" | "PARTY" | "FACE"; started_at: Date;
      status: string; host_application_user_id: string; reward_rule_id: string | null;
    })[]>(
      `SELECT accounting.id accounting_id, room.id room_id, accounting.room_type, accounting.started_at,
              accounting.status, accounting.host_application_user_id, accounting.reward_rule_id
       FROM live_session_accounting accounting INNER JOIN live_rooms room ON room.id = accounting.room_id
       WHERE room.room_code = ? LIMIT 1 FOR UPDATE`,
      [roomCode],
    );
    const session = rows[0];
    if (!session || session.host_application_user_id !== identity.userId) throw new Error("Only the room owner can finalize this Live session.");
    if (session.status !== "ACTIVE") throw new Error("This Live session was already finalized.");
    const [durationRows] = await connection.query<(RowDataPacket & { seconds: number })[]>("SELECT GREATEST(0, TIMESTAMPDIFF(SECOND, ?, CURRENT_TIMESTAMP(3))) seconds", [session.started_at]);
    const validSeconds = Number(durationRows[0].seconds);
    const [ruleRows] = await connection.query<(RowDataPacket & { id: string; coins_per_hour: number; minimum_eligible_seconds: number })[]>(
      session.reward_rule_id
        ? "SELECT id, coins_per_hour, minimum_eligible_seconds FROM host_reward_rules WHERE id = ? LIMIT 1"
        : `SELECT id, coins_per_hour, minimum_eligible_seconds FROM host_reward_rules
           WHERE room_type = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1`,
      session.reward_rule_id ? [session.reward_rule_id] : [session.room_type, session.started_at],
    );
    const rule = ruleRows[0];
    if (!rule) throw new Error("The host reward rule is unavailable.");
    const eligibleSeconds = validSeconds >= Number(rule.minimum_eligible_seconds) ? validSeconds : 0;
    const rewardCoins = session.room_type === "PARTY" ? 0 : Math.floor(eligibleSeconds * Number(rule.coins_per_hour) / 3600);
    let ledgerId: string | null = null;
    let rewardCode: string | null = null;
    if (rewardCoins > 0) {
      await ensureWallet(connection, identity.userId, "COIN");
      ledgerId = randomUUID(); rewardCode = code("HST");
      await connection.execute("UPDATE wallet_balances SET available_balance = available_balance + ? WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN'", [rewardCoins, identity.userId]);
      await connection.execute(
        `INSERT INTO ledger_transactions
          (id, transaction_code, asset_type, transaction_type, source_type, destination_type, destination_id, amount, status, reason)
         VALUES (?, ?, 'COIN', 'HOST_HOURLY_REWARD', 'SYSTEM', 'APPLICATION_USER', ?, ?, 'COMPLETED', ?)`,
        [ledgerId, rewardCode, identity.userId, rewardCoins, `${session.room_type} • ${eligibleSeconds} eligible seconds`],
      );
    }
    await connection.execute(
      `UPDATE live_session_accounting SET ended_at = CURRENT_TIMESTAMP(3), valid_duration_seconds = ?, eligible_duration_seconds = ?,
       reward_rule_id = ?, reward_coins = ?, reward_ledger_id = ?, status = 'FINALIZED', finalized_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      [validSeconds, eligibleSeconds, rule.id, rewardCoins, ledgerId, session.accounting_id],
    );
    await connection.execute("UPDATE live_rooms SET status = 'ENDED', ended_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [session.room_id]);
    return { transactionId: rewardCode, roomType: session.room_type.toLowerCase(), validSeconds, eligibleSeconds, rewardCoins };
  });
}

export async function submitAutomaticFaceVerification(identity: MobileIdentity, input: { framesBase64: string[]; consentVersion: string }) {
  const frames = input.framesBase64.map((frame) => Buffer.from(frame, "base64"));
  const result = await new FaceBiometricService().verify({ subjectId: identity.userId, consentVersion: input.consentVersion, frames });
  const requestId = randomUUID();
  const retained = result.retainReferenceImage
    ? await preparePrivateDocument(new File([Uint8Array.from(frames[0])], "face-reference.jpg", { type: "image/jpeg" }), randomUUID(), "FACE_REFERENCE")
    : null;
  await withTransaction(async (connection) => {
    let duplicateUserId: string | null = null;
    if (result.duplicateSubjectId) {
      const [duplicates] = await connection.query<(RowDataPacket & { id: string })[]>("SELECT id FROM application_users WHERE id = ? LIMIT 1", [result.duplicateSubjectId]);
      duplicateUserId = duplicates[0]?.id ?? null;
    }
    if (retained) {
      await connection.execute(
        `INSERT INTO private_documents (id, owner_type, owner_id, document_type, original_name, mime_type, byte_size, encrypted_data, encryption_iv, encryption_tag)
         VALUES (?, 'FACE_VERIFICATION', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [retained.id, requestId, retained.documentType, retained.originalName, retained.mimeType, retained.byteSize, retained.encryptedData, retained.iv, retained.tag],
      );
    }
    await connection.execute(
      `INSERT INTO face_verification_requests
        (id, application_user_id, selfie_document_id, status, provider, provider_face_id, embedding_reference,
         liveness_score, match_score, duplicate_application_user_id, verified_at, review_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [requestId, identity.userId, retained?.id ?? null, result.status, result.provider, result.providerFaceId,
        result.embeddingReference, result.livenessScore, result.matchScore, duplicateUserId,
        result.status === "VERIFIED" ? new Date() : null, result.reason],
    );
    await connection.execute("UPDATE application_users SET face_verification_status = ? WHERE id = ?", [result.status, identity.userId]);
    if (result.status === "DUPLICATE") {
      await connection.execute(
        "INSERT INTO risk_flags (id, application_user_id, severity, rule_key, summary) VALUES (?, ?, 'HIGH', 'DUPLICATE_FACE', ?)",
        [randomUUID(), identity.userId, result.reason],
      );
    }
    await connection.execute(
      "INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'FACE_VERIFICATION', ?, ?, 'face')",
      [randomUUID(), identity.userId, result.status === "VERIFIED" ? "Face verification complete" : result.status === "DUPLICATE" ? "Duplicate face detected" : "Retake Face Verification", result.reason],
    );
  });
  return { status: result.status.toLowerCase(), reason: result.reason, livenessScore: result.livenessScore };
}

function periodStart(period: "daily" | "weekly" | "monthly") {
  return period === "daily" ? "DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY)"
    : period === "weekly" ? "DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY)"
      : "DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY)";
}

async function leaderboardFor(period: "daily" | "weekly" | "monthly") {
  const start = periodStart(period);
  const [gifters, hosts, agencies] = await Promise.all([
    db().query<RowDataPacket[]>(
      `SELECT user.public_id, user.full_name, user.level_number, user.vip_tier, SUM(ledger.amount) score
       FROM ledger_transactions ledger INNER JOIN application_users user ON user.id = ledger.source_id
       WHERE ledger.transaction_type = 'GIFT_SPEND' AND ledger.status = 'COMPLETED' AND ledger.created_at >= ${start}
       GROUP BY user.id, user.public_id, user.full_name, user.level_number, user.vip_tier ORDER BY score DESC, user.public_id LIMIT 50`,
    ),
    db().query<RowDataPacket[]>(
      `SELECT user.public_id, user.full_name, user.level_number, user.vip_tier, SUM(ledger.amount) score
       FROM ledger_transactions ledger INNER JOIN application_users user ON user.id = ledger.destination_id
       WHERE ledger.transaction_type = 'GIFT_RECEIVE' AND ledger.status = 'COMPLETED' AND ledger.created_at >= ${start}
       GROUP BY user.id, user.public_id, user.full_name, user.level_number, user.vip_tier ORDER BY score DESC, user.public_id LIMIT 50`,
    ),
    db().query<RowDataPacket[]>(
      `SELECT agency.public_id, agency.full_name, SUM(ledger.amount) score
       FROM ledger_transactions ledger INNER JOIN application_users user ON user.id = ledger.destination_id
       INNER JOIN platform_accounts agency ON agency.id = user.agency_account_id
       WHERE ledger.transaction_type = 'GIFT_RECEIVE' AND ledger.status = 'COMPLETED' AND ledger.created_at >= ${start}
       GROUP BY agency.id, agency.public_id, agency.full_name ORDER BY score DESC, agency.public_id LIMIT 50`,
    ),
  ]);
  const users = (rows: RowDataPacket[]) => rows.map((row, index) => ({ rank: index + 1, user: { id: String(row.public_id), name: String(row.full_name), level: Number(row.level_number), vip: Number(row.vip_tier), role: "host" }, score: Number(row.score), label: period }));
  return {
    topGifters: users(gifters[0]), topHosts: users(hosts[0]),
    topAgencies: agencies[0].map((row, index) => ({ rank: index + 1, agency: { id: String(row.public_id), code: String(row.public_id), name: String(row.full_name), country: "", ownerUserId: "0", status: "ACTIVE", hosts: [], targetProgress: 0, estimatedEarnings: Number(row.score), totalLiveMinutes: 0 }, score: Number(row.score), label: period })),
  };
}

export async function mobileCompletionSnapshot(identity: MobileIdentity) {
  const [rewardRules, claimRows, conversionRows, exchangeRows, rewardHistoryRows, policyRows, discoveryRows, avatarRows, leaderboards, agencyApplications, posts, privateMessaging] = await Promise.all([
    db().query<RowDataPacket[]>("SELECT day_number, reward_coins, label FROM daily_reward_rules WHERE enabled = TRUE ORDER BY day_number"),
    db().query<RowDataPacket[]>("SELECT claim_date, streak_day, reward_coins, claim_code, claimed_at FROM daily_reward_claims WHERE application_user_id = ? ORDER BY claim_date DESC LIMIT 31", [identity.userId]),
    db().query<RowDataPacket[]>("SELECT id, diamonds, coins, minimum_diamonds, maximum_diamonds, effective_from FROM diamond_conversion_rules WHERE enabled = TRUE AND effective_from <= CURRENT_TIMESTAMP(3) ORDER BY effective_from DESC LIMIT 1"),
    db().query<RowDataPacket[]>("SELECT exchange_code, diamonds_debited, coins_credited, created_at FROM diamond_coin_exchanges WHERE application_user_id = ? ORDER BY created_at DESC LIMIT 50", [identity.userId]),
    db().query<RowDataPacket[]>("SELECT room_type, started_at, ended_at, valid_duration_seconds, eligible_duration_seconds, reward_coins, status FROM live_session_accounting WHERE host_application_user_id = ? ORDER BY started_at DESC LIMIT 50", [identity.userId]),
    db().query<RowDataPacket[]>("SELECT policy_key, version, title, summary, body_json, effective_from FROM policy_documents WHERE active = TRUE AND effective_from <= CURRENT_TIMESTAMP(3) ORDER BY policy_key, effective_from DESC"),
    db().query<(RowDataPacket & { setting_value: unknown })[]>("SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.discovery' LIMIT 1"),
    db().query<RowDataPacket[]>("SELECT updated_at FROM application_user_avatars WHERE application_user_id = ? LIMIT 1", [identity.userId]),
    Promise.all([leaderboardFor("daily"), leaderboardFor("weekly"), leaderboardFor("monthly")]),
    agencyApplicationsForUser(identity),
    discoveryPosts(),
    privateMessagingForUser(identity),
  ]);
  const claims = claimRows[0];
  const lastClaimDate = claims[0]?.claim_date ? String(claims[0].claim_date).slice(0, 10) : null;
  const [clockRows] = await db().query<(RowDataPacket & { today: string })[]>("SELECT CURRENT_DATE today");
  const today = String(clockRows[0].today).slice(0, 10);
  const discoveryRaw = discoveryRows[0][0]?.setting_value;
  const discovery = typeof discoveryRaw === "string" ? JSON.parse(discoveryRaw) : (discoveryRaw ?? {});
  const uniquePolicies = new Map<string, RowDataPacket>();
  for (const row of policyRows[0]) if (!uniquePolicies.has(String(row.policy_key))) uniquePolicies.set(String(row.policy_key), row);
  return {
    accessPolicy: LiveAccessPolicyService.for(identity),
    dailyRewards: {
      rules: rewardRules[0].map((row) => ({ dayNumber: Number(row.day_number), rewardCoins: Number(row.reward_coins), label: String(row.label) })),
      currentStreak: claims.length ? Number(claims[0].streak_day) : 0,
      claimable: lastClaimDate !== today,
      serverDate: today,
      lastClaimDate,
      history: claims.map((row) => ({ date: String(row.claim_date).slice(0, 10), streakDay: Number(row.streak_day), rewardCoins: Number(row.reward_coins), transactionId: String(row.claim_code), claimedAt: row.claimed_at })),
    },
    diamondConversionRule: conversionRows[0][0] ? { id: String(conversionRows[0][0].id), diamonds: Number(conversionRows[0][0].diamonds), coins: Number(conversionRows[0][0].coins), minimum: Number(conversionRows[0][0].minimum_diamonds), maximum: Number(conversionRows[0][0].maximum_diamonds), enabled: true, effectiveFrom: conversionRows[0][0].effective_from } : null,
    diamondExchangeHistory: exchangeRows[0].map((row) => ({ transactionId: String(row.exchange_code), diamonds: Number(row.diamonds_debited), coins: Number(row.coins_credited), createdAt: row.created_at })),
    hostRewardHistory: rewardHistoryRows[0].map((row) => ({ roomType: String(row.room_type).toLowerCase(), startedAt: row.started_at, endedAt: row.ended_at, validSeconds: Number(row.valid_duration_seconds), eligibleSeconds: Number(row.eligible_duration_seconds), rewardCoins: Number(row.reward_coins), status: String(row.status).toLowerCase() })),
    policies: [...uniquePolicies.values()].map((row) => ({ key: String(row.policy_key), version: String(row.version), title: String(row.title), summary: String(row.summary), sections: (typeof row.body_json === "string" ? JSON.parse(row.body_json) : row.body_json as { sections?: unknown[] })?.sections ?? [], effectiveFrom: row.effective_from })),
    discovery,
    profileAvatarVersion: avatarRows[0][0]?.updated_at ? new Date(avatarRows[0][0].updated_at).getTime() : null,
    leaderboards: { daily: leaderboards[0], weekly: leaderboards[1], monthly: leaderboards[2] },
    agencyApplications,
    posts,
    privateMessaging,
  };
}
