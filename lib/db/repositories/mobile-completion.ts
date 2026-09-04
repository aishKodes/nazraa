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
import { publicImageFromDataUrl } from "@/lib/security/public-images";
import { agencyApplicationsForUser, agencyOwnerSnapshot, discoveryPosts, privateMessagingForUser } from "@/lib/db/repositories/mobile-social";
import {
  finalizePkSession,
  pkStreakSnapshot,
  settlePreviousWeeklyGifterRewards,
  vipSnapshot,
} from "@/lib/db/repositories/mobile-rewards";

function code(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function roomMediaDelivery(
  row: RowDataPacket,
  participantCount: number,
) {
  const features = jsonObject(row.room_features_json);
  const threshold = Math.max(2, Math.min(200, Number(features.partyStreamingThreshold ?? 9)));
  const reconnectGraceSeconds = Math.max(5, Math.min(300, Number(features.mediaReconnectGraceSeconds ?? 180)));
  const passiveBackgroundGraceSeconds = Math.max(5, Math.min(60, Number(features.passiveBackgroundGraceSeconds ?? 15)));
  const maxFaceAudioGuests = Math.max(1, Math.min(12, Number(features.maxFaceAudioGuests ?? 4)));
  const rtcPassiveFallbackCeiling = Math.max(1, Math.min(100, Number(features.rtcPassiveFallbackCeiling ?? 20)));
  // The panel flag is an operator preference. The deployment gate proves that
  // the ZEGO project, mixer output and signed playback endpoint are actually
  // ready. Never move an audience member away from the working RTC fallback
  // merely because a panel toggle was enabled early.
  const mixingConfigured = features.streamMixingEnabled === true;
  const mixingReady = process.env.ZEGO_STREAM_MIXING_READY === "true";
  const mixingEnabled = mixingConfigured && mixingReady;
  const isAudience = row.room_role === "AUDIENCE";
  const requested = row.room_type === "PARTY"
    ? features.partyPassivePlaybackMode === "live_streaming" && participantCount >= threshold
    : features.facePassivePlaybackMode === "live_streaming";
  const template = process.env.ZEGO_CDN_PLAYBACK_URL_TEMPLATE?.trim() ?? "";
  const mixerPlaybackUrl = typeof row.mixer_playback_url === "string" ? row.mixer_playback_url.trim() : "";
  const playbackUrl = mixerPlaybackUrl || (template.length > 0 ? template.replaceAll("{streamId}", encodeURIComponent(`nazraa_${String(row.id).replaceAll("-", "")}`)) : "");
  const mixerActive = row.mixer_status === "ACTIVE";
  const enabled = isAudience && requested && mixingEnabled && mixerActive && playbackUrl.length > 0;
  const streamId = `nazraa_${String(row.id).replaceAll("-", "")}`;
  return {
    mode: enabled ? "liveStreaming" : "rtcFallback",
    playbackUrl: enabled ? playbackUrl : null,
    streamId: enabled ? streamId : null,
    streamMixingEnabled: mixingEnabled,
    partyStreamingThreshold: threshold,
    reconnectGraceSeconds,
    passiveBackgroundGraceSeconds,
    maxFaceAudioGuests,
    rtcPassiveFallbackCeiling,
    fallbackReason: enabled
      ? null
      : !requested
        ? "Passive streaming is disabled by server configuration."
        : !mixingConfigured
          ? "ZEGO stream mixing is not active."
          : !mixingReady
            ? "ZEGO stream mixing is awaiting deployment activation."
          : playbackUrl.length === 0
            ? "ZEGO signed playback URL is not configured."
          : !mixerActive
            ? "The passive stream is starting; RTC fallback remains active."
            : "Active speakers and hosts remain on RTC.",
  };
}

async function ensureWallet(connection: PoolConnection, userId: string, assetType: "COIN" | "DIAMOND") {
  await connection.execute(
    "INSERT IGNORE INTO wallet_balances (id, owner_type, owner_id, asset_type) VALUES (?, 'APPLICATION_USER', ?, ?)",
    [randomUUID(), userId, assetType],
  );
}

export async function updateMobileProfile(identity: MobileIdentity, input: {
  displayName: string; bio: string; gender: "FEMALE" | "MALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY";
  countryCode: string; languageCode: string; whatsappE164: string; avatarDataUrl?: string;
}) {
  const avatar = input.avatarDataUrl
    ? await publicImageFromDataUrl(input.avatarDataUrl, 1024 * 1024, "Profile photo", { maxWidth: 900, maxHeight: 900 })
    : null;
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
        [identity.userId, avatar.mimeType, avatar.data, avatar.byteSize],
      );
      await connection.execute("UPDATE application_users SET avatar_url = NULL WHERE id = ?", [identity.userId]);
    }
  });
  return {
    updated: true,
    avatarUrl: avatar ? `https://nazraa.vercel.app/api/v1/mobile/avatar/${identity.publicId}?v=${Date.now()}` : undefined,
  };
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
    const [clockRows] = await connection.query<(RowDataPacket & { today: string })[]>("SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d') today");
    const today = String(clockRows[0].today);
    const [lastRows] = await connection.query<(RowDataPacket & { claim_date: string; streak_day: number })[]>(
      "SELECT DATE_FORMAT(claim_date, '%Y-%m-%d') claim_date, streak_day FROM daily_reward_claims WHERE application_user_id = ? ORDER BY claim_date DESC LIMIT 1 FOR UPDATE",
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

export async function markMobileNotificationsRead(identity: MobileIdentity) {
  const [result] = await db().execute(
    `UPDATE mobile_notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP(3))
     WHERE application_user_id = ? AND read_at IS NULL`,
    [identity.userId],
  );
  return { read: (result as { affectedRows?: number }).affectedRows ?? 0 };
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
    if (room.host_application_user_id !== identity.userId) {
      const [blocks] = await connection.query<RowDataPacket[]>(
        "SELECT 1 FROM live_room_blocks WHERE room_id = ? AND application_user_id = ? LIMIT 1",
        [room.id, identity.userId],
      );
      if (blocks[0]) throw new Error("The room owner has blocked you from this Live.");
    }
    if (room.host_application_user_id !== identity.userId && room.password_hash) {
      if (!password || !(await bcrypt.compare(password, room.password_hash))) {
        throw new Error("The room password is incorrect.");
      }
    }
    const requestedRole = room.host_application_user_id === identity.userId
      ? "OWNER"
      : "AUDIENCE";
    const requestedMediaRole = room.room_type === "PARTY"
      ? requestedRole === "OWNER" ? "PARTY_OWNER" : "PASSIVE_LISTENER"
      : requestedRole === "OWNER" ? "HOST" : "PASSIVE_VIEWER";
    await connection.execute(
      `INSERT INTO live_room_members (room_id, application_user_id, room_role, media_role, muted, left_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE seat_index = IF(left_at IS NULL, seat_index, NULL),
         room_role = IF(room_role IN ('OWNER','ADMIN') OR left_at IS NULL, room_role, VALUES(room_role)),
         media_role = IF(left_at IS NULL, media_role, VALUES(media_role)),
         muted = IF(left_at IS NULL, muted, VALUES(muted)), muted_by_staff = IF(left_at IS NULL, muted_by_staff, FALSE), left_at = NULL, last_seen_at = CURRENT_TIMESTAMP(3)`,
      [room.id, identity.userId, requestedRole, requestedMediaRole, requestedRole === "AUDIENCE"],
    );
    await connection.execute(
      `UPDATE live_rooms SET audience_count = (
         SELECT COUNT(*) FROM live_room_members WHERE room_id = ? AND left_at IS NULL
       ) WHERE id = ?`,
      [room.id, room.id],
    );
    const [members] = await connection.query<(RowDataPacket & { room_role: string; media_role: string })[]>(
      "SELECT room_role, media_role FROM live_room_members WHERE room_id = ? AND application_user_id = ? LIMIT 1",
      [room.id, identity.userId],
    );
    return {
      role: String(members[0].room_role).toLowerCase(),
      mediaRole: String(members[0].media_role).toLowerCase(),
    };
  });
}

export async function leaveLiveRoom(identity: MobileIdentity, roomCode: string) {
  return withTransaction(async (connection) => {
    const [rooms] = await connection.query<(RowDataPacket & { id: string; host_application_user_id: string; room_type: string })[]>(
      "SELECT id, host_application_user_id, room_type FROM live_rooms WHERE room_code = ? AND status IN ('ACTIVE','LOCKED') LIMIT 1 FOR UPDATE",
      [roomCode],
    );
    const room = rooms[0];
    if (!room) return { left: true };
    if (room.host_application_user_id === identity.userId) {
      if (room.room_type !== "PARTY") throw new Error("Use Close Room to end a Face Live session.");
      const [admins] = await connection.query<(RowDataPacket & { application_user_id: string; public_id: number })[]>(
        `SELECT member.application_user_id, user.public_id FROM live_room_members member
         INNER JOIN application_users user ON user.id = member.application_user_id AND user.account_status = 'ACTIVE'
         WHERE member.room_id = ? AND member.room_role = 'ADMIN' AND member.left_at IS NULL
           AND member.last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 2 MINUTE
         ORDER BY member.joined_at LIMIT 1 FOR UPDATE`,
        [room.id],
      );
      const successor = admins[0];
      if (!successor) throw new Error("Appoint a Room Admin to keep this Party open, or choose Close Room.");
      await connection.execute("UPDATE live_room_members SET left_at = CURRENT_TIMESTAMP(3), muted = TRUE, seat_index = NULL, media_role = 'PASSIVE_LISTENER', media_publishing = FALSE WHERE room_id = ? AND application_user_id = ?", [room.id, identity.userId]);
      await connection.execute("UPDATE live_room_members SET room_role = 'OWNER', media_role = 'PARTY_OWNER' WHERE room_id = ? AND application_user_id = ?", [room.id, successor.application_user_id]);
      await connection.execute(
        `UPDATE live_rooms SET host_application_user_id = ?, audience_count = (
          SELECT COUNT(*) FROM live_room_members WHERE room_id = ? AND left_at IS NULL
        ) WHERE id = ?`,
        [successor.application_user_id, room.id, room.id],
      );
      await connection.execute("UPDATE live_session_accounting SET host_application_user_id = ? WHERE room_id = ? AND status = 'ACTIVE'", [successor.application_user_id, room.id]);
      await connection.execute("UPDATE live_media_access_grants SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3)) WHERE room_id = ? AND application_user_id = ?", [room.id, identity.userId]);
      await connection.execute("UPDATE live_media_usage SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3)) WHERE room_id = ? AND application_user_id = ?", [room.id, identity.userId]);
      return { left: true, transferredTo: String(successor.public_id) };
    }
    await connection.execute(
      `UPDATE live_room_members SET left_at = CURRENT_TIMESTAMP(3), muted = TRUE, seat_index = NULL,
         media_role = ?, media_publishing = FALSE
       WHERE room_id = ? AND application_user_id = ?`,
      [room.room_type === "PARTY" ? "PASSIVE_LISTENER" : "PASSIVE_VIEWER", room.id, identity.userId],
    );
    if (["LIVE", "FACE"].includes(room.room_type)) {
      await connection.execute(
        `UPDATE live_cohost_requests
         SET status = CASE WHEN status = 'PENDING' THEN 'CANCELED' ELSE 'ENDED' END,
             ended_at = CURRENT_TIMESTAMP(3)
         WHERE room_id = ? AND requester_application_user_id = ? AND status IN ('PENDING','ACCEPTED')`,
        [room.id, identity.userId],
      );
    }
    await connection.execute(
      `UPDATE live_rooms SET audience_count = (
         SELECT COUNT(*) FROM live_room_members WHERE room_id = ? AND left_at IS NULL
       ) WHERE id = ?`,
      [room.id, room.id],
    );
    await connection.execute("UPDATE live_media_access_grants SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3)) WHERE room_id = ? AND application_user_id = ?", [room.id, identity.userId]);
    await connection.execute("UPDATE live_media_usage SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3)) WHERE room_id = ? AND application_user_id = ?", [room.id, identity.userId]);
    return { left: true };
  });
}

export async function finalizeStaleLiveSession(roomCode: string) {
  const [rows] = await db().query<(RowDataPacket & { host_application_user_id: string })[]>(
    `SELECT room.host_application_user_id
     FROM live_rooms room
     INNER JOIN live_room_members host_member
       ON host_member.room_id = room.id AND host_member.application_user_id = room.host_application_user_id
     LEFT JOIN live_session_accounting accounting ON accounting.room_id = room.id AND accounting.status = 'ACTIVE'
     LEFT JOIN system_settings settings ON settings.setting_key = 'mobile.room_features'
     WHERE room.room_code = ? AND room.room_type IN ('FACE','LIVE') AND room.status IN ('ACTIVE','LOCKED')
       AND (
         host_member.last_seen_at < TIMESTAMPADD(SECOND,
           -LEAST(600, GREATEST(60, COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(settings.setting_value, '$.roomStaleGraceSeconds')) AS UNSIGNED), 300))),
           CURRENT_TIMESTAMP(3))
         AND (accounting.id IS NULL OR accounting.last_media_heartbeat_at IS NULL OR accounting.last_media_heartbeat_at < TIMESTAMPADD(SECOND,
           -LEAST(600, GREATEST(60, COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(settings.setting_value, '$.roomStaleGraceSeconds')) AS UNSIGNED), 300))),
           CURRENT_TIMESTAMP(3)))
       )
     LIMIT 1`,
    [roomCode],
  );
  if (!rows[0]) return;
  // The finalizer only reads userId from the identity and rechecks/locks the
  // active session, so the server can close a crashed broadcaster cleanly.
  await finalizeLiveSession({ userId: rows[0].host_application_user_id } as MobileIdentity, roomCode);
}

export async function refreshRoomPresence(identity: MobileIdentity, roomCode: string, mediaPublishing?: boolean) {
  await finalizeStaleLiveSession(roomCode);
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT room.id, room.chat_locked, room.theme_index, room.theme_enabled, room.audio_join_requests_enabled, room.room_type,
              member.room_role, member.media_role, member.seat_index, member.muted, member.muted_by_staff,
              accounting.id reward_accounting_id, accounting.started_at reward_started_at,
              accounting.media_publishing reward_media_publishing,
              accounting.last_media_heartbeat_at reward_last_media_heartbeat_at,
              accounting.media_segment_seconds reward_media_segment_seconds,
              accounting.valid_media_seconds reward_valid_media_seconds,
              accounting.eligible_duration_seconds reward_eligible_seconds,
              accounting.reward_coins reward_coins_paid,
              accounting.reward_rule_id reward_rule_id,
              reward_rule.coins_per_hour reward_diamonds_per_hour,
              reward_rule.minimum_eligible_seconds reward_minimum_eligible_seconds,
              room_features.setting_value room_features_json,
              COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(room_features.setting_value, '$.mediaReconnectGraceSeconds')) AS UNSIGNED), 60) media_reconnect_grace_seconds,
              CURRENT_TIMESTAMP(3) reward_server_time,
              mixer.status mixer_status, mixer.playback_url mixer_playback_url,
              COALESCE((SELECT wallet.available_balance FROM wallet_balances wallet
                WHERE wallet.owner_type = 'APPLICATION_USER' AND wallet.owner_id = member.application_user_id AND wallet.asset_type = 'COIN' LIMIT 1), 0) coin_balance,
              COALESCE((SELECT wallet.available_balance FROM wallet_balances wallet
                WHERE wallet.owner_type = 'APPLICATION_USER' AND wallet.owner_id = member.application_user_id AND wallet.asset_type = 'DIAMOND' LIMIT 1), 0) diamond_balance
       FROM live_rooms room
       INNER JOIN live_room_members member ON member.room_id = room.id AND member.application_user_id = ? AND member.left_at IS NULL
       LEFT JOIN live_session_accounting accounting ON accounting.room_id = room.id AND accounting.status = 'ACTIVE'
       LEFT JOIN host_reward_rules reward_rule ON reward_rule.id = accounting.reward_rule_id
       LEFT JOIN system_settings room_features ON room_features.setting_key = 'mobile.room_features'
       LEFT JOIN live_media_mix_tasks mixer ON mixer.room_id = room.id
       WHERE room.room_code = ? AND room.status IN ('ACTIVE','LOCKED') LIMIT 1 FOR UPDATE`,
      [identity.userId, roomCode],
    );
    if (!rows[0]) return { active: false };
    const reconnectGrace = Math.max(5, Math.min(300, Number(rows[0].media_reconnect_grace_seconds ?? 180)));
    await connection.execute(
      `UPDATE live_room_members
       SET room_role = 'AUDIENCE', media_role = 'PASSIVE_VIEWER', muted = TRUE,
           muted_by_staff = FALSE, media_publishing = FALSE
       WHERE room_id = ? AND media_role = 'AUDIO_GUEST'
         AND application_user_id <> ? AND left_at IS NULL
         AND last_seen_at < TIMESTAMPADD(SECOND, -?, CURRENT_TIMESTAMP(3))`,
      [rows[0].id, identity.userId, reconnectGrace],
    );
    await connection.execute(
      `UPDATE live_cohost_requests request
       INNER JOIN live_room_members member
         ON member.room_id = request.room_id AND member.application_user_id = request.requester_application_user_id
       SET request.status = 'ENDED', request.ended_at = CURRENT_TIMESTAMP(3)
       WHERE request.room_id = ? AND request.status = 'ACCEPTED'
         AND member.media_role = 'PASSIVE_VIEWER'`,
      [rows[0].id],
    );
    if (mediaPublishing !== undefined) {
      const publishAuthorized = ["HOST", "PARTY_OWNER", "AUDIO_GUEST", "RTC_SPEAKER"].includes(String(rows[0].media_role));
      const effectivePublishing = mediaPublishing && publishAuthorized && !Boolean(rows[0].muted);
      await connection.execute(
        `UPDATE live_room_members
         SET media_publishing = ?, last_media_heartbeat_at = CURRENT_TIMESTAMP(3)
         WHERE room_id = ? AND application_user_id = ? AND left_at IS NULL`,
        [effectivePublishing, rows[0].id, identity.userId],
      );
      mediaPublishing = effectivePublishing;
    }
    let rewardSegmentSeconds = Number(rows[0].reward_media_segment_seconds ?? 0);
    let rewardValidSeconds = Number(rows[0].reward_valid_media_seconds ?? 0);
    let rewardEligibleSeconds = Number(rows[0].reward_eligible_seconds ?? 0);
    if (rows[0].room_role === "OWNER" && rows[0].room_type !== "PARTY" && rows[0].reward_accounting_id) {
      // Releases before 2.4.16 did not include this field. Their host-only,
      // in-room heartbeat remains the compatibility signal until the current
      // build is published; current clients always send an explicit value.
      const publishingNow = mediaPublishing ?? true;
      const wasPublishing = Boolean(rows[0].reward_media_publishing);
      const lastHeartbeat = rows[0].reward_last_media_heartbeat_at
        ? new Date(rows[0].reward_last_media_heartbeat_at as string | Date)
        : null;
      const serverTime = new Date(rows[0].reward_server_time as string | Date);
      const gapSeconds = lastHeartbeat == null
        ? 0
        : Math.max(0, Math.floor((serverTime.getTime() - lastHeartbeat.getTime()) / 1000));
      // A single false SDK heartbeat is not proof that the broadcast ended.
      // Preserve the continuous segment through the configured reconnect grace
      // and only break it after the grace has genuinely elapsed.
      const acceptedDelta = gapSeconds <= reconnectGrace && (wasPublishing || publishingNow)
        ? gapSeconds
        : 0;
      rewardSegmentSeconds += acceptedDelta;
      rewardValidSeconds += acceptedDelta;
      const disconnectedBeyondGrace = !wasPublishing && !publishingNow && gapSeconds > reconnectGrace;
      const resumedBeyondGrace = !wasPublishing && publishingNow && gapSeconds > reconnectGrace;
      const missedPublishingHeartbeat = wasPublishing && gapSeconds > reconnectGrace;
      if (disconnectedBeyondGrace || resumedBeyondGrace || missedPublishingHeartbeat) {
        rewardEligibleSeconds += Math.floor(rewardSegmentSeconds / 3600) * 3600;
        rewardSegmentSeconds = 0;
      }
      const heartbeatAnchor = publishingNow || wasPublishing || gapSeconds > reconnectGrace || lastHeartbeat == null
        ? serverTime
        : lastHeartbeat;
      await connection.execute(
        `UPDATE live_session_accounting
         SET media_publishing = ?, last_media_heartbeat_at = ?,
             media_segment_seconds = ?, valid_media_seconds = ?, eligible_duration_seconds = ?
         WHERE id = ? AND status = 'ACTIVE'`,
        [publishingNow, heartbeatAnchor, rewardSegmentSeconds, rewardValidSeconds, rewardEligibleSeconds, rows[0].reward_accounting_id],
      );

      // Settle every completed continuous hour immediately. This is entirely
      // server-authoritative, survives an app restart, and no longer depends
      // on the room eventually reaching the close/finalize path.
      const rewardRate = Number(rows[0].reward_diamonds_per_hour ?? 3500);
      const minimumEligibleSeconds = Math.max(3600, Number(rows[0].reward_minimum_eligible_seconds ?? 3600));
      const completedRewardHours = rewardEligibleSeconds + rewardSegmentSeconds >= minimumEligibleSeconds
        ? Math.floor((rewardEligibleSeconds + rewardSegmentSeconds) / 3600)
        : 0;
      const totalRewardDiamonds = completedRewardHours * rewardRate;
      const alreadyPaidDiamonds = Number(rows[0].reward_coins_paid ?? 0);
      const rewardDue = Math.max(0, totalRewardDiamonds - alreadyPaidDiamonds);
      if (rewardDue > 0) {
        const ledgerId = randomUUID();
        const rewardCode = code("HST");
        const idempotencyKey = `HOST-HOUR:${rows[0].reward_accounting_id}:${completedRewardHours}`;
        await ensureWallet(connection, identity.userId, "DIAMOND");
        await connection.execute(
          "UPDATE wallet_balances SET available_balance = available_balance + ? WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'DIAMOND'",
          [rewardDue, identity.userId],
        );
        await connection.execute(
          `INSERT INTO ledger_transactions
            (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, destination_type, destination_id, amount, status, reason)
           VALUES (?, ?, ?, 'DIAMOND', 'HOST_HOURLY_DIAMONDS', 'SYSTEM', 'APPLICATION_USER', ?, ?, 'COMPLETED', ?)`,
          [ledgerId, rewardCode, idempotencyKey, identity.userId, rewardDue, `${rows[0].room_type} • through ${completedRewardHours} completed continuous hour(s)`],
        );
        await connection.execute(
          "UPDATE live_session_accounting SET reward_coins = ?, reward_ledger_id = ? WHERE id = ? AND status = 'ACTIVE'",
          [totalRewardDiamonds, ledgerId, rows[0].reward_accounting_id],
        );
        await connection.execute(
          "INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'HOST_REWARD', 'Live reward credited', ?, 'wallet/rewards')",
          [randomUUID(), identity.userId, `${rewardDue.toLocaleString("en-IN")} Diamonds credited for completed Live hour${rewardDue === rewardRate ? "" : "s"}.`],
        );
        rows[0].reward_coins_paid = totalRewardDiamonds;
        rows[0].diamond_balance = Number(rows[0].diamond_balance ?? 0) + rewardDue;
      }
    }
    const [requests] = await connection.query<RowDataPacket[]>(
      `SELECT user.public_id, user.full_name, request.seat_index, request.status
       FROM live_seat_requests request INNER JOIN application_users user ON user.id = request.application_user_id
       INNER JOIN live_room_members member ON member.room_id = request.room_id AND member.application_user_id = user.id
       WHERE request.room_id = ? AND member.left_at IS NULL AND request.requested_at >= CURRENT_TIMESTAMP(3) - INTERVAL 2 MINUTE
         AND (request.application_user_id = ? OR (? AND request.status = 'PENDING'))
       ORDER BY request.requested_at LIMIT 50`, [rows[0].id, identity.userId, ["OWNER", "ADMIN"].includes(String(rows[0].room_role)) ? 1 : 0]);
    await connection.execute(
      `UPDATE live_cohost_requests SET status = 'EXPIRED', ended_at = CURRENT_TIMESTAMP(3)
       WHERE room_id = ? AND status = 'PENDING'
         AND requested_at < CURRENT_TIMESTAMP(3) - INTERVAL 2 MINUTE`,
      [rows[0].id],
    );
    await connection.execute(
      `UPDATE live_room_members member
       LEFT JOIN live_cohost_requests request
         ON request.room_id = member.room_id AND request.requester_application_user_id = member.application_user_id
       SET member.media_role = 'PASSIVE_VIEWER'
       WHERE member.room_id = ? AND member.media_role = 'AUDIO_REQUESTED'
         AND (request.status IS NULL OR request.status <> 'PENDING')`,
      [rows[0].id],
    );
    const [coHostRequests] = await connection.query<RowDataPacket[]>(
      `SELECT user.public_id, user.full_name, request.status, request.requested_at,
              CASE WHEN avatar.updated_at IS NOT NULL
                THEN CONCAT('https://nazraa.vercel.app/api/v1/mobile/avatar/', user.public_id, '?v=', FLOOR(UNIX_TIMESTAMP(avatar.updated_at) * 1000))
                ELSE user.avatar_url END avatar_url
       FROM live_cohost_requests request
       INNER JOIN application_users user ON user.id = request.requester_application_user_id
       LEFT JOIN application_user_avatars avatar ON avatar.application_user_id = user.id
       INNER JOIN live_room_members member
         ON member.room_id = request.room_id
        AND member.application_user_id = request.requester_application_user_id
       WHERE request.room_id = ? AND member.left_at IS NULL
         AND (request.requester_application_user_id = ?
           OR (? AND request.status = 'PENDING'))
       ORDER BY request.requested_at LIMIT 25`,
      [rows[0].id, identity.userId, rows[0].room_role === "OWNER" ? 1 : 0],
    );
    const [pkSessions] = await connection.query<RowDataPacket[]>(
      `SELECT session.id, session.status, session.mode, session.duration_minutes,
              session.created_at, session.started_at,
              source.room_code source_room_code, target.room_code target_room_code,
              source_user.public_id source_host_public_id, source_user.full_name source_host_name,
              target_user.public_id target_host_public_id, target_user.full_name target_host_name
       FROM live_pk_sessions session
       INNER JOIN live_rooms source ON source.id = session.source_room_id
       INNER JOIN live_rooms target ON target.id = session.target_room_id
       INNER JOIN application_users source_user ON source_user.id = source.host_application_user_id
       INNER JOIN application_users target_user ON target_user.id = target.host_application_user_id
       WHERE session.status IN ('REQUESTED','ACTIVE')
         AND (session.source_room_id = ? OR session.target_room_id = ?)
       ORDER BY session.created_at DESC LIMIT 1`,
      [rows[0].id, rows[0].id],
    );
    const [messages] = await connection.query<RowDataPacket[]>(
      `SELECT message.id, user.full_name, user.vip_tier, message.body, message.created_at FROM live_room_messages message
       INNER JOIN application_users user ON user.id = message.sender_application_user_id
       WHERE message.room_id = ? AND message.visible = TRUE ORDER BY message.created_at DESC LIMIT 60`, [rows[0].id]);
    const [seatLocks] = await connection.query<RowDataPacket[]>(
      "SELECT seat_index FROM live_room_seat_locks WHERE room_id = ? ORDER BY seat_index",
      [rows[0].id],
    );
    await connection.execute(
      "UPDATE live_room_members SET last_seen_at = CURRENT_TIMESTAMP(3) WHERE room_id = ? AND application_user_id = ? AND left_at IS NULL",
      [rows[0].id, identity.userId],
    );
    const [participants] = await connection.query<RowDataPacket[]>(
      `SELECT user.public_id, user.full_name,
              LEAST(120, FLOOR(SQRT(GREATEST(0, user.consumption_points) / 5000)) + 1) consumption_level,
              LEAST(200, FLOOR(SQRT(GREATEST(0, user.anchor_income_points) / 10000)) + 1) anchor_level,
              user.vip_tier, user.country_code, user.language_code, member.room_role, member.media_role, member.seat_index, member.muted, member.muted_by_staff,
              (SELECT COUNT(*) FROM user_follows follow_link WHERE follow_link.followed_application_user_id = user.id) followers,
              (SELECT COUNT(*) FROM user_follows follow_link WHERE follow_link.follower_application_user_id = user.id) following,
              CASE WHEN avatar.updated_at IS NOT NULL
                THEN CONCAT('https://nazraa.vercel.app/api/v1/mobile/avatar/', user.public_id, '?v=', FLOOR(UNIX_TIMESTAMP(avatar.updated_at) * 1000))
                ELSE user.avatar_url END avatar_url,
              COALESCE(gifts.received_value, 0) received_gift_value
       FROM live_room_members member
       INNER JOIN application_users user ON user.id = member.application_user_id
       LEFT JOIN application_user_avatars avatar ON avatar.application_user_id = user.id
       LEFT JOIN (
         SELECT room_id, receiver_application_user_id, SUM(coin_value) received_value
         FROM live_room_gift_events WHERE room_id = ? GROUP BY room_id, receiver_application_user_id
       ) gifts ON gifts.room_id = member.room_id AND gifts.receiver_application_user_id = member.application_user_id
       WHERE member.room_id = ? AND member.left_at IS NULL
         AND member.last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 2 MINUTE
       ORDER BY member.room_role = 'OWNER' DESC, member.joined_at`,
      [rows[0].id, rows[0].id],
    );
    const [giftEvents] = await connection.query<RowDataPacket[]>(
      `SELECT event.id, event.quantity, event.coin_value, event.created_at,
              gift.gift_key, gift.name gift_name, gift.emoji gift_emoji, gift.visual_url gift_visual_url,
              sender.public_id sender_public_id, sender.full_name sender_name, sender.vip_tier sender_vip,
              sender.country_code sender_country, sender.language_code sender_language,
              LEAST(120, FLOOR(SQRT(GREATEST(0, sender.consumption_points) / 5000)) + 1) sender_level,
              LEAST(200, FLOOR(SQRT(GREATEST(0, sender.anchor_income_points) / 10000)) + 1) sender_anchor_level,
              CASE WHEN sender_avatar.updated_at IS NOT NULL
                THEN CONCAT('https://nazraa.vercel.app/api/v1/mobile/avatar/', sender.public_id, '?v=', FLOOR(UNIX_TIMESTAMP(sender_avatar.updated_at) * 1000))
                ELSE sender.avatar_url END sender_avatar_url,
              receiver.public_id receiver_public_id, receiver.full_name receiver_name, receiver.vip_tier receiver_vip,
              receiver.country_code receiver_country, receiver.language_code receiver_language,
              LEAST(120, FLOOR(SQRT(GREATEST(0, receiver.consumption_points) / 5000)) + 1) receiver_level,
              LEAST(200, FLOOR(SQRT(GREATEST(0, receiver.anchor_income_points) / 10000)) + 1) receiver_anchor_level,
              CASE WHEN receiver_avatar.updated_at IS NOT NULL
                THEN CONCAT('https://nazraa.vercel.app/api/v1/mobile/avatar/', receiver.public_id, '?v=', FLOOR(UNIX_TIMESTAMP(receiver_avatar.updated_at) * 1000))
                ELSE receiver.avatar_url END receiver_avatar_url
       FROM live_room_gift_events event
       INNER JOIN gift_catalog gift ON gift.id = event.gift_catalog_id
       INNER JOIN application_users sender ON sender.id = event.sender_application_user_id
       INNER JOIN application_users receiver ON receiver.id = event.receiver_application_user_id
       LEFT JOIN application_user_avatars sender_avatar ON sender_avatar.application_user_id = sender.id
       LEFT JOIN application_user_avatars receiver_avatar ON receiver_avatar.application_user_id = receiver.id
       WHERE event.room_id = ? ORDER BY event.created_at DESC LIMIT 50`,
      [rows[0].id],
    );
    const [interactions] = await connection.query<RowDataPacket[]>(
      `SELECT event.id, event.interaction_key, event.created_at,
              sender.public_id sender_public_id, sender.full_name sender_name,
              target.public_id target_public_id, target.full_name target_name
       FROM room_interaction_events event
       INNER JOIN application_users sender ON sender.id = event.sender_application_user_id
       INNER JOIN application_users target ON target.id = event.target_application_user_id
       WHERE event.room_id = ?
         AND event.created_at >= CURRENT_TIMESTAMP(3) - INTERVAL 30 SECOND
       ORDER BY event.created_at ASC LIMIT 50`,
      [rows[0].id],
    );
    const [gameWinEvents] = await connection.query<RowDataPacket[]>(
      `SELECT ledger.id, ledger.amount coins, ledger.created_at,
              COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ledger.metadata, '$.game')), 'Nazraa Game') game_name,
              user.public_id, user.full_name, user.vip_tier, user.country_code, user.language_code,
              LEAST(120, FLOOR(SQRT(GREATEST(0, user.consumption_points) / 5000)) + 1) consumption_level,
              LEAST(200, FLOOR(SQRT(GREATEST(0, user.anchor_income_points) / 10000)) + 1) anchor_level,
              CASE WHEN avatar.updated_at IS NOT NULL
                THEN CONCAT('https://nazraa.vercel.app/api/v1/mobile/avatar/', user.public_id, '?v=', FLOOR(UNIX_TIMESTAMP(avatar.updated_at) * 1000))
                ELSE user.avatar_url END avatar_url
       FROM ledger_transactions ledger
       INNER JOIN application_users user ON user.id = ledger.destination_id
       LEFT JOIN application_user_avatars avatar ON avatar.application_user_id = user.id
       WHERE ledger.transaction_type IN ('GAME_CREDIT', 'GAME_WIN') AND ledger.status = 'COMPLETED'
         AND ledger.created_at >= CURRENT_TIMESTAMP(3) - INTERVAL 30 SECOND
       ORDER BY ledger.created_at ASC LIMIT 30`,
    );
    const [rocketEvents] = await connection.query<RowDataPacket[]>(
      `SELECT cycle.id, cycle.rocket_level, cycle.completed_at,
              user.public_id, user.full_name, user.vip_tier, user.country_code, user.language_code,
              LEAST(120, FLOOR(SQRT(GREATEST(0, user.consumption_points) / 5000)) + 1) consumption_level,
              LEAST(200, FLOOR(SQRT(GREATEST(0, user.anchor_income_points) / 10000)) + 1) anchor_level,
              CASE WHEN avatar.updated_at IS NOT NULL
                THEN CONCAT('https://nazraa.vercel.app/api/v1/mobile/avatar/', user.public_id, '?v=', FLOOR(UNIX_TIMESTAMP(avatar.updated_at) * 1000))
                ELSE user.avatar_url END avatar_url
       FROM rocket_cycles cycle
       INNER JOIN rocket_contributions contribution ON contribution.rocket_cycle_id = cycle.id
         AND contribution.created_at = (SELECT MAX(latest.created_at) FROM rocket_contributions latest WHERE latest.rocket_cycle_id = cycle.id)
       INNER JOIN application_users user ON user.id = contribution.application_user_id
       LEFT JOIN application_user_avatars avatar ON avatar.application_user_id = user.id
       WHERE cycle.room_id = ? AND cycle.status = 'COMPLETED'
         AND cycle.completed_at >= CURRENT_TIMESTAMP(3) - INTERVAL 30 SECOND
       ORDER BY cycle.completed_at ASC LIMIT 10`,
      [rows[0].id],
    );
    const audienceCount = participants.filter((member) => String(member.room_role) === "AUDIENCE").length;
    const mediaDelivery = roomMediaDelivery(rows[0], audienceCount);
    const currentMediaRole = String(rows[0].media_role);
    const publishingRole = ["HOST", "PARTY_OWNER", "AUDIO_GUEST", "RTC_SPEAKER"].includes(currentMediaRole);
    const activeMedia = publishingRole ? mediaPublishing === true : true;
    const usageType = rows[0].room_type === "FACE"
      ? currentMediaRole === "HOST"
        ? "FACE_HOST_RTC"
        : currentMediaRole === "AUDIO_GUEST"
          ? "FACE_AUDIO_GUEST_RTC"
          : mediaDelivery.mode === "liveStreaming" ? "FACE_PASSIVE_STREAM" : "FACE_PASSIVE_RTC_FALLBACK"
      : rows[0].room_type === "PARTY"
        ? ["PARTY_OWNER", "RTC_SPEAKER"].includes(currentMediaRole)
          ? "PARTY_SPEAKER_RTC"
          : mediaDelivery.mode === "liveStreaming" ? "PARTY_PASSIVE_STREAM" : "PARTY_PASSIVE_RTC_FALLBACK"
        : currentMediaRole === "HOST" || currentMediaRole === "AUDIO_GUEST"
          ? "FACE_HOST_RTC"
          : "FACE_PASSIVE_RTC_FALLBACK";
    if (activeMedia) {
      await connection.execute(
        `INSERT INTO live_media_usage
          (room_id, application_user_id, usage_type, duration_seconds, first_seen_at, last_seen_at, ended_at)
         VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), NULL)
         ON DUPLICATE KEY UPDATE
           duration_seconds = duration_seconds + IF(
             TIMESTAMPDIFF(SECOND, last_seen_at, CURRENT_TIMESTAMP(3)) BETWEEN 0 AND 10,
             TIMESTAMPDIFF(SECOND, last_seen_at, CURRENT_TIMESTAMP(3)), 0),
           last_seen_at = CURRENT_TIMESTAMP(3), ended_at = NULL`,
        [rows[0].id, identity.userId, usageType],
      );
    } else {
      await connection.execute(
        "UPDATE live_media_usage SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3)) WHERE room_id = ? AND application_user_id = ? AND ended_at IS NULL",
        [rows[0].id, identity.userId],
      );
    }
    const pkSession = pkSessions[0];
    return {
      active: true,
      serverTime: rows[0].reward_server_time,
      roomRole: String(rows[0].room_role).toLowerCase(), mediaRole: currentMediaRole.toLowerCase(), seatIndex: rows[0].seat_index,
      muted: Boolean(rows[0].muted), staffMuted: Boolean(rows[0].muted_by_staff), chatLocked: Boolean(rows[0].chat_locked),
      themeIndex: Number(rows[0].theme_index), themeEnabled: Boolean(rows[0].theme_enabled),
      audioJoinRequestsEnabled: Boolean(rows[0].audio_join_requests_enabled),
      liveRewardProgress: rows[0].room_role === "OWNER" && rows[0].room_type !== "PARTY" && rows[0].reward_started_at
        ? {
            rewardDiamondsPerHour: Number(rows[0].reward_diamonds_per_hour ?? 3500),
            liveElapsedSeconds: Math.max(0, Math.floor((new Date(rows[0].reward_server_time as string | Date).getTime() - new Date(rows[0].reward_started_at as string | Date).getTime()) / 1000)),
            continuousSeconds: rewardSegmentSeconds,
            completedHours: Math.floor((rewardEligibleSeconds + rewardSegmentSeconds) / 3600),
            secondsUntilNextReward: 3600 - (rewardSegmentSeconds % 3600),
            serverTime: rows[0].reward_server_time,
          }
        : null,
      wallet: { coins: Number(rows[0].coin_balance), diamonds: Number(rows[0].diamond_balance) },
      mediaDelivery,
      pkSession: pkSession
        ? {
            id: String(pkSession.id),
            status: String(pkSession.status).toLowerCase(),
            mode: String(pkSession.mode),
            durationMinutes: Number(pkSession.duration_minutes),
            requestedAt: pkSession.created_at,
            startedAt: pkSession.started_at,
            sourceRoomCode: String(pkSession.source_room_code),
            targetRoomCode: String(pkSession.target_room_code),
            sourceHost: { id: String(pkSession.source_host_public_id), name: String(pkSession.source_host_name) },
            targetHost: { id: String(pkSession.target_host_public_id), name: String(pkSession.target_host_name) },
            sourceStreamId: `${String(pkSession.source_room_code)}_${String(pkSession.source_host_public_id)}_main`,
            targetStreamId: `${String(pkSession.target_room_code)}_${String(pkSession.target_host_public_id)}_main`,
            isSourceRoom: String(pkSession.source_room_code) === roomCode,
          }
        : null,
      lockedSeatIndexes: seatLocks.map((row) => Number(row.seat_index)),
      seatRequests: requests.map((row) => ({ userId: String(row.public_id), name: String(row.full_name), seatIndex: Number(row.seat_index), status: String(row.status).toLowerCase() })),
      coHostRequests: coHostRequests.map((row) => ({ userId: String(row.public_id), name: String(row.full_name), avatarUrl: row.avatar_url, status: String(row.status).toLowerCase(), requestedAt: row.requested_at })),
      messages: messages.reverse().map((row) => ({ id: String(row.id), actor: String(row.full_name), actorVip: Number(row.vip_tier), body: String(row.body), createdAt: row.created_at })),
      participants: participants.map((member) => ({
        user: { id: String(member.public_id), name: String(member.full_name), avatarUrl: member.avatar_url, country: member.country_code ?? "", language: member.language_code ?? "", level: Number(member.consumption_level), anchorLevel: Number(member.anchor_level), vip: Number(member.vip_tier), followers: Number(member.followers ?? 0), following: Number(member.following ?? 0) },
        roomRole: String(member.room_role).toLowerCase(), mediaRole: String(member.media_role).toLowerCase(), seatIndex: member.seat_index == null ? null : Number(member.seat_index), muted: Boolean(member.muted), staffMuted: Boolean(member.muted_by_staff), receivedGiftValue: Number(member.received_gift_value),
      })),
      giftEvents: giftEvents.reverse().map((event) => ({
        id: String(event.id), quantity: Number(event.quantity), value: Number(event.coin_value), createdAt: event.created_at,
        gift: { id: String(event.gift_key), name: String(event.gift_name), symbol: event.gift_emoji ?? "🎁", imageUrl: event.gift_visual_url },
        sender: { id: String(event.sender_public_id), name: String(event.sender_name), avatarUrl: event.sender_avatar_url, country: event.sender_country ?? "", language: event.sender_language ?? "", level: Number(event.sender_level), anchorLevel: Number(event.sender_anchor_level), vip: Number(event.sender_vip) },
        receiver: { id: String(event.receiver_public_id), name: String(event.receiver_name), avatarUrl: event.receiver_avatar_url, country: event.receiver_country ?? "", language: event.receiver_language ?? "", level: Number(event.receiver_level), anchorLevel: Number(event.receiver_anchor_level), vip: Number(event.receiver_vip) },
      })),
      interactions: interactions.map((event) => ({
        id: String(event.id), interactionKey: String(event.interaction_key),
        senderPublicId: String(event.sender_public_id), senderName: String(event.sender_name),
        targetPublicId: String(event.target_public_id), targetName: String(event.target_name),
        createdAt: event.created_at,
      })),
      gameWinEvents: gameWinEvents.map((event) => ({
        id: String(event.id), coins: Number(event.coins), game: String(event.game_name).replaceAll('_', ' '), createdAt: event.created_at,
        user: { id: String(event.public_id), name: String(event.full_name), avatarUrl: event.avatar_url, country: event.country_code ?? "", language: event.language_code ?? "", level: Number(event.consumption_level), anchorLevel: Number(event.anchor_level), vip: Number(event.vip_tier) },
      })),
      rocketEvents: rocketEvents.map((event) => ({
        id: String(event.id), level: Number(event.rocket_level), createdAt: event.completed_at,
        user: { id: String(event.public_id), name: String(event.full_name), avatarUrl: event.avatar_url, country: event.country_code ?? "", language: event.language_code ?? "", level: Number(event.consumption_level), anchorLevel: Number(event.anchor_level), vip: Number(event.vip_tier) },
      })),
    };
  });
}

export async function requestLiveCoHost(identity: MobileIdentity, roomCode: string) {
  const policy = LiveAccessPolicyService.for(identity);
  if (!policy.chat.allowed) throw new Error(policy.chat.reason);
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { id: string; room_type: string; host_application_user_id: string; room_role: string; audio_join_requests_enabled: number })[]>(
      `SELECT room.id, room.room_type, room.host_application_user_id, room.audio_join_requests_enabled, member.room_role
       FROM live_rooms room
       INNER JOIN live_room_members member
         ON member.room_id = room.id AND member.application_user_id = ? AND member.left_at IS NULL
       WHERE room.room_code = ? AND room.status IN ('ACTIVE','LOCKED') LIMIT 1 FOR UPDATE`,
      [identity.userId, roomCode],
    );
    const room = rows[0];
    if (!room || !["LIVE", "FACE"].includes(room.room_type)) throw new Error("Join an active Face Live first.");
    if (room.host_application_user_id === identity.userId || room.room_role === "OWNER") throw new Error("The room owner is already live.");
    if (!Boolean(room.audio_join_requests_enabled)) throw new Error("The host is not accepting audio join requests right now.");
    if (room.room_role === "SPEAKER") return { status: "accepted" };
    await connection.execute(
      `INSERT INTO live_cohost_requests
        (id, room_id, requester_application_user_id, status, requested_at, responded_at, responder_application_user_id, ended_at)
       VALUES (?, ?, ?, 'PENDING', CURRENT_TIMESTAMP(3), NULL, NULL, NULL)
       ON DUPLICATE KEY UPDATE status = 'PENDING', requested_at = CURRENT_TIMESTAMP(3),
         responded_at = NULL, responder_application_user_id = NULL, ended_at = NULL`,
      [randomUUID(), room.id, identity.userId],
    );
    await connection.execute(
      "UPDATE live_room_members SET media_role = 'AUDIO_REQUESTED', media_publishing = FALSE WHERE room_id = ? AND application_user_id = ? AND room_role = 'AUDIENCE' AND left_at IS NULL",
      [room.id, identity.userId],
    );
    return { status: "pending" };
  });
}

export async function respondLiveCoHost(identity: MobileIdentity, input: { roomCode: string; targetPublicId: string; accept: boolean }) {
  return withTransaction(async (connection) => {
    const [rooms] = await connection.query<(RowDataPacket & { id: string; room_type: string; host_application_user_id: string; room_features_json: unknown })[]>(
      `SELECT room.id, room.room_type, room.host_application_user_id, settings.setting_value room_features_json
       FROM live_rooms room LEFT JOIN system_settings settings ON settings.setting_key = 'mobile.room_features'
       WHERE room.room_code = ? AND room.status IN ('ACTIVE','LOCKED') LIMIT 1 FOR UPDATE`,
      [input.roomCode],
    );
    const room = rooms[0];
    if (!room || !["LIVE", "FACE"].includes(room.room_type)) throw new Error("This Face Live is no longer active.");
    if (room.host_application_user_id !== identity.userId) {
      throw new Error("Only the room owner can accept audio requests.");
    }
    const [targets] = await connection.query<(RowDataPacket & { id: string; face_verification_status: string; request_status: string; host_access_override: number })[]>(
      `SELECT user.id, user.face_verification_status, request.status request_status,
              (COALESCE(access_override.host_access_override, FALSE) OR user.public_id = 12000006) host_access_override
       FROM application_users user
       INNER JOIN live_room_members member
         ON member.application_user_id = user.id AND member.room_id = ? AND member.left_at IS NULL
       INNER JOIN live_cohost_requests request
         ON request.requester_application_user_id = user.id AND request.room_id = member.room_id
       LEFT JOIN mobile_access_overrides access_override ON access_override.application_user_id = user.id
       WHERE user.public_id = ? LIMIT 1 FOR UPDATE`,
      [room.id, input.targetPublicId],
    );
    const target = targets[0];
    if (!target || target.request_status !== "PENDING") {
      throw new Error("This audio request is no longer pending.");
    }
    if (input.accept) {
      const maxAudioGuests = Math.max(1, Math.min(12, Number(jsonObject(room.room_features_json).maxFaceAudioGuests ?? 4)));
      const [speakerRows] = await connection.query<(RowDataPacket & { count: number })[]>(
        "SELECT COUNT(*) count FROM live_room_members WHERE room_id = ? AND room_role = 'SPEAKER' AND left_at IS NULL",
        [room.id],
      );
      if (Number(speakerRows[0]?.count ?? 0) >= maxAudioGuests) {
        throw new Error(`Face Live already has the maximum ${maxAudioGuests} audio guests.`);
      }
    }
    await connection.execute(
      `UPDATE live_cohost_requests SET status = ?, responded_at = CURRENT_TIMESTAMP(3),
         responder_application_user_id = ?, ended_at = CASE WHEN ? THEN NULL ELSE CURRENT_TIMESTAMP(3) END
       WHERE room_id = ? AND requester_application_user_id = ?`,
      [input.accept ? "ACCEPTED" : "REJECTED", identity.userId, input.accept, room.id, target.id],
    );
    await connection.execute(
      `UPDATE live_room_members SET room_role = ?,
         media_role = CASE WHEN ? THEN 'AUDIO_GUEST' ELSE 'PASSIVE_VIEWER' END,
         muted = ?, muted_by_staff = FALSE, media_publishing = FALSE
       WHERE room_id = ? AND application_user_id = ? AND left_at IS NULL`,
      [input.accept ? "SPEAKER" : "AUDIENCE", input.accept,
        !input.accept, room.id, target.id],
    );
    return {
      status: input.accept ? "accepted" : "rejected",
      mediaMode: "audio_only",
    };
  });
}

export async function endLiveCoHost(identity: MobileIdentity, input: { roomCode: string; targetPublicId?: string }) {
  return withTransaction(async (connection) => {
    const [rooms] = await connection.query<(RowDataPacket & { id: string; host_application_user_id: string })[]>(
      "SELECT id, host_application_user_id FROM live_rooms WHERE room_code = ? AND status IN ('ACTIVE','LOCKED') LIMIT 1 FOR UPDATE",
      [input.roomCode],
    );
    const room = rooms[0];
    if (!room) return { status: "ended" };
    const targetPublicId = input.targetPublicId ?? identity.publicId;
    if (targetPublicId !== identity.publicId && room.host_application_user_id !== identity.userId) {
      throw new Error("Only the room owner can disconnect another co-host.");
    }
    const [targets] = await connection.query<(RowDataPacket & { id: string })[]>(
      `SELECT user.id FROM application_users user
       INNER JOIN live_room_members member ON member.application_user_id = user.id
       WHERE member.room_id = ? AND member.left_at IS NULL AND user.public_id = ? LIMIT 1 FOR UPDATE`,
      [room.id, targetPublicId],
    );
    const target = targets[0];
    if (!target || target.id === room.host_application_user_id) return { status: "ended" };
    await connection.execute(
      "UPDATE live_room_members SET room_role = 'AUDIENCE', media_role = 'PASSIVE_VIEWER', muted = TRUE, muted_by_staff = FALSE, media_publishing = FALSE WHERE room_id = ? AND application_user_id = ? AND left_at IS NULL",
      [room.id, target.id],
    );
    await connection.execute("UPDATE live_media_access_grants SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3)) WHERE room_id = ? AND application_user_id = ? AND can_publish = TRUE", [room.id, target.id]);
    await connection.execute("UPDATE live_media_usage SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3)) WHERE room_id = ? AND application_user_id = ? AND usage_type = 'FACE_AUDIO_GUEST_RTC'", [room.id, target.id]);
    await connection.execute(
      `UPDATE live_cohost_requests
       SET status = CASE WHEN status = 'PENDING' THEN 'CANCELED' ELSE 'ENDED' END,
           ended_at = CURRENT_TIMESTAMP(3)
       WHERE room_id = ? AND requester_application_user_id = ? AND status IN ('PENDING','ACCEPTED')`,
      [room.id, target.id],
    );
    return { status: "ended" };
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
    const [members] = await db().query<(RowDataPacket & { room_role: string; muted: number })[]>(
      "SELECT room_role, muted FROM live_room_members WHERE room_id = ? AND application_user_id = ? AND left_at IS NULL LIMIT 1",
      [room.id, identity.userId],
    );
    if (!members[0] || !["OWNER", "ADMIN", "SPEAKER"].includes(String(members[0].room_role))) {
      throw new Error("An active Party speaker role is required to publish audio.");
    }
    if (Boolean(members[0].muted)) {
      throw new Error("Your microphone is muted by room staff.");
    }
    return policy.chat;
  }
  if (room.host_application_user_id !== identity.userId) {
    const [members] = await db().query<(RowDataPacket & { room_role: string; muted: number })[]>(
      "SELECT room_role, muted FROM live_room_members WHERE room_id = ? AND application_user_id = ? AND left_at IS NULL LIMIT 1",
      [room.id, identity.userId],
    );
    if (!members[0] || members[0].room_role !== "SPEAKER" || Boolean(members[0].muted)) {
      throw new Error("The host must accept your audio request before microphone access.");
    }
    if (!policy.chat.allowed) throw new Error(policy.chat.reason);
    return policy.chat;
  }
  const access = policy.face;
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
        `INSERT INTO live_room_members (room_id, application_user_id, room_role, media_role, muted, left_at)
         VALUES (?, ?, 'ADMIN', 'PASSIVE_LISTENER', TRUE, NULL)
         ON DUPLICATE KEY UPDATE room_role = 'ADMIN', media_role = IF(seat_index IS NULL, 'PASSIVE_LISTENER', 'RTC_SPEAKER'), left_at = NULL`,
        [room.id, target.id],
      );
    } else {
      await connection.execute("UPDATE live_room_members SET room_role = 'AUDIENCE', media_role = IF(seat_index IS NULL, 'PASSIVE_LISTENER', 'RTC_SPEAKER') WHERE room_id = ? AND application_user_id = ? AND room_role = 'ADMIN'", [room.id, target.id]);
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
    const [rows] = await connection.query<(RowDataPacket & { room_id: string; room_type: string; actor_role: string; target_id: string; target_role: string; muted_by_staff: number })[]>(
      `SELECT room.id room_id, actor.room_role actor_role,
              room.room_type, target.application_user_id target_id, target.room_role target_role, target.muted_by_staff
       FROM live_rooms room
       INNER JOIN live_room_members actor ON actor.room_id = room.id
         AND actor.application_user_id = ? AND actor.left_at IS NULL
       INNER JOIN live_room_members target ON target.room_id = room.id AND target.left_at IS NULL
       INNER JOIN application_users target_user ON target_user.id = target.application_user_id
       WHERE room.room_code = ? AND room.status IN ('ACTIVE','LOCKED') AND target_user.public_id = ?
       LIMIT 1 FOR UPDATE`,
      [identity.userId, input.roomCode, input.targetPublicId],
    );
    const member = rows[0];
    if (!member) throw new Error("Both users must be active in this room.");
    const selfAction = member.target_id === identity.userId;
    if (!selfAction && !["OWNER", "ADMIN"].includes(member.actor_role)) {
      throw new Error("Only the Room Owner or a Room Admin can manage microphones.");
    }
    if (!selfAction && member.target_role === "OWNER") {
      throw new Error("The Room Owner microphone is controlled on the owner device.");
    }
    if (!selfAction && member.actor_role === "ADMIN" && member.target_role === "ADMIN") {
      throw new Error("Only the Room Owner can manage another Room Admin microphone.");
    }
    if (selfAction && !input.muted && Boolean(member.muted_by_staff)) {
      throw new Error("Your microphone is muted by room staff.");
    }
    await connection.execute(
      `UPDATE live_room_members
       SET muted = ?, muted_by_staff = IF(?, muted_by_staff, ?),
           media_publishing = IF(?, FALSE, media_publishing)
       WHERE room_id = ? AND application_user_id = ?`,
      [input.muted, selfAction, input.muted, input.muted, member.room_id, member.target_id],
    );
    if (!selfAction) {
      await connection.execute(
        `INSERT INTO audit_logs
          (id, actor_role, action, module, target_type, target_id, new_data, reason)
         VALUES (?, ?, ?, 'LIVE_ROOM', 'APPLICATION_USER', ?,
           JSON_OBJECT('roomCode', ?, 'roomType', ?, 'muted', ?), 'Authorized in-room microphone moderation.')`,
        [randomUUID(), member.actor_role, input.muted ? "ROOM_MEMBER_MUTED" : "ROOM_MEMBER_UNMUTE_REQUESTED",
          member.target_id, input.roomCode, member.room_type, input.muted],
      );
    }
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
    const configured = settings?.interactions;
    const available = configured?.length
      ? configured
      : ["kiss", "love", "hug", "heart", "cheer", "applause", "flower", "like", "smile", "star", "gift", "fire"].map((key) => ({ key, enabled: true }));
    const allowed = new Set(available.filter((item) => item.enabled !== false).map((item) => item.key).filter(Boolean));
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
    const availableModes = settings?.pkModes ?? ["Classic", "Auto PK", "Random", "Invite/Friends"];
    const availableDurations = (settings?.pkDurations ?? [2, 5, 10]).map(Number);
    if (!availableModes.includes(input.mode) || !availableDurations.includes(input.durationMinutes)) {
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
      throw new Error("PK is available only between Face Live rooms.");
    }
    await connection.execute(
      "UPDATE live_pk_sessions SET status = 'EXPIRED', ended_at = CURRENT_TIMESTAMP(3) WHERE status = 'REQUESTED' AND created_at < TIMESTAMPADD(SECOND, -70, CURRENT_TIMESTAMP(3))",
    );
    const [busySessions] = await connection.query<RowDataPacket[]>(
      `SELECT id FROM live_pk_sessions
       WHERE status IN ('REQUESTED','ACTIVE')
         AND (source_room_id IN (?, ?) OR target_room_id IN (?, ?))
       LIMIT 1 FOR UPDATE`,
      [roomsPair.source_id, roomsPair.target_id, roomsPair.source_id, roomsPair.target_id],
    );
    if (busySessions.length) throw new Error("One of these Hosts is already in a PK invitation or battle.");
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

export async function activatePkSession(identity: MobileIdentity, sessionId: string) {
  return withTransaction(async (connection) => {
    const [sessions] = await connection.query<(RowDataPacket & {
      id: string;
      status: string;
      source_host_id: string;
      target_host_id: string;
      source_room_code: string;
      target_room_code: string;
      source_status: string;
      target_status: string;
    })[]>(
      `SELECT session.id, session.status,
              source.host_application_user_id source_host_id,
              target.host_application_user_id target_host_id,
              source.room_code source_room_code, target.room_code target_room_code,
              source.status source_status, target.status target_status
       FROM live_pk_sessions session
       INNER JOIN live_rooms source ON source.id = session.source_room_id
       INNER JOIN live_rooms target ON target.id = session.target_room_id
       WHERE session.id = ? LIMIT 1 FOR UPDATE`,
      [sessionId],
    );
    const session = sessions[0];
    if (!session || ![session.source_host_id, session.target_host_id].includes(identity.userId)) {
      throw new Error("Only an invited Host can start this PK session.");
    }
    if (!["ACTIVE", "LOCKED"].includes(session.source_status) || !["ACTIVE", "LOCKED"].includes(session.target_status)) {
      throw new Error("Both Hosts must still be Live to start PK.");
    }
    if (session.status === "ACTIVE") {
      return { id: session.id, status: "active", sourceRoomCode: session.source_room_code, targetRoomCode: session.target_room_code };
    }
    if (session.status !== "REQUESTED") throw new Error("This PK invitation is no longer pending.");
    await connection.execute(
      "UPDATE live_pk_sessions SET status = 'ACTIVE', started_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
      [session.id],
    );
    return { id: session.id, status: "active", sourceRoomCode: session.source_room_code, targetRoomCode: session.target_room_code };
  });
}

export async function respondPkSession(identity: MobileIdentity, input: { sessionId: string; accept: boolean }) {
  return withTransaction(async (connection) => {
    const [sessions] = await connection.query<(RowDataPacket & {
      id: string; status: string; source_host_id: string; target_host_id: string;
      source_room_code: string; target_room_code: string; created_at: Date;
    })[]>(
      `SELECT session.id, session.status, session.created_at,
              source.host_application_user_id source_host_id,
              target.host_application_user_id target_host_id,
              source.room_code source_room_code, target.room_code target_room_code
       FROM live_pk_sessions session
       INNER JOIN live_rooms source ON source.id = session.source_room_id
       INNER JOIN live_rooms target ON target.id = session.target_room_id
       WHERE session.id = ? LIMIT 1 FOR UPDATE`,
      [input.sessionId],
    );
    const session = sessions[0];
    if (!session || session.target_host_id !== identity.userId) {
      throw new Error("Only the invited Host can respond to this PK invitation.");
    }
    if (session.status === "ACTIVE" && input.accept) {
      return { id: session.id, status: "active", sourceRoomCode: session.source_room_code, targetRoomCode: session.target_room_code };
    }
    if (session.status !== "REQUESTED") throw new Error("This PK invitation is no longer pending.");
    if (new Date(session.created_at).getTime() < Date.now() - 70_000) {
      await connection.execute("UPDATE live_pk_sessions SET status = 'EXPIRED', ended_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [session.id]);
      throw new Error("This PK invitation expired. Ask the Host to send it again.");
    }
    if (!input.accept) {
      await connection.execute("UPDATE live_pk_sessions SET status = 'REJECTED', ended_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [session.id]);
      return { id: session.id, status: "rejected", sourceRoomCode: session.source_room_code, targetRoomCode: session.target_room_code };
    }
    await connection.execute(
      "UPDATE live_pk_sessions SET status = 'ACTIVE', started_at = CURRENT_TIMESTAMP(3), ended_at = NULL WHERE id = ?",
      [session.id],
    );
    return { id: session.id, status: "active", sourceRoomCode: session.source_room_code, targetRoomCode: session.target_room_code };
  });
}

export async function closePkSession(identity: MobileIdentity, input: { sessionId: string; completed: boolean }) {
  return finalizePkSession(identity, input);
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

export async function updateRoomSettings(identity: MobileIdentity, input: { roomCode: string; themeIndex?: number; themeEnabled?: boolean; pkRequestsEnabled?: boolean; audioJoinRequestsEnabled?: boolean; chatLocked?: boolean; password?: string; removePassword: boolean; topPublicId?: string; resetTopDp: boolean }) {
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { room_id: string; actor_role: string; theme_index: number; theme_enabled: number; pk_requests_enabled: number; audio_join_requests_enabled: number; chat_locked: number; password_hash: string | null; password_length: number | null; top_application_user_id: string | null })[]>(
      `SELECT room.id room_id, member.room_role actor_role, room.theme_index, room.chat_locked,
              room.password_hash, room.password_length, room.theme_enabled, room.pk_requests_enabled, room.audio_join_requests_enabled, room.top_application_user_id
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
      `UPDATE live_rooms SET theme_index = ?, theme_enabled = ?, pk_requests_enabled = ?, audio_join_requests_enabled = ?, chat_locked = ?, password_hash = ?, password_length = ?, top_application_user_id = ?,
         privacy = IF(? IS NULL, IF(privacy = 'LOCKED', 'PUBLIC', privacy), 'LOCKED')
       WHERE id = ?`,
      [input.themeIndex ?? Number(room.theme_index), input.themeEnabled ?? Boolean(room.theme_enabled), input.pkRequestsEnabled ?? Boolean(room.pk_requests_enabled), input.audioJoinRequestsEnabled ?? Boolean(room.audio_join_requests_enabled), input.chatLocked ?? Boolean(room.chat_locked), passwordHash, passwordLength, topUserId,
        passwordHash, room.room_id],
    );
    return { themeIndex: input.themeIndex ?? Number(room.theme_index), themeEnabled: input.themeEnabled ?? Boolean(room.theme_enabled), pkRequestsEnabled: input.pkRequestsEnabled ?? Boolean(room.pk_requests_enabled), audioJoinRequestsEnabled: input.audioJoinRequestsEnabled ?? Boolean(room.audio_join_requests_enabled), chatLocked: input.chatLocked ?? Boolean(room.chat_locked), passwordRequired: passwordHash != null, topPublicId: input.topPublicId ?? null };
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

export async function kickRoomMember(identity: MobileIdentity, input: { roomCode: string; targetPublicId: string; block?: boolean }) {
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
      "UPDATE live_room_members SET left_at = CURRENT_TIMESTAMP(3), muted = TRUE, media_role = IF(media_role IN ('PARTY_OWNER','PASSIVE_LISTENER','MIC_REQUESTED','RTC_SPEAKER'), 'PASSIVE_LISTENER', 'PASSIVE_VIEWER'), media_publishing = FALSE WHERE room_id = ? AND application_user_id = ?",
      [member.room_id, member.target_id],
    );
    await connection.execute("UPDATE live_media_access_grants SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3)) WHERE room_id = ? AND application_user_id = ?", [member.room_id, member.target_id]);
    await connection.execute("UPDATE live_media_usage SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3)) WHERE room_id = ? AND application_user_id = ?", [member.room_id, member.target_id]);
    if (input.block) {
      await connection.execute(
        `INSERT INTO live_room_blocks (room_id, application_user_id, blocked_by_application_user_id)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE blocked_by_application_user_id = VALUES(blocked_by_application_user_id), created_at = CURRENT_TIMESTAMP(3)`,
        [member.room_id, member.target_id, identity.userId],
      );
    }
    await connection.execute(
      `INSERT INTO audit_logs
        (id, actor_role, action, module, target_type, target_id, new_data, reason)
       VALUES (?, ?, ?, 'LIVE_ROOM', 'APPLICATION_USER', ?, JSON_OBJECT('roomCode', ?, 'blocked', ?), 'Authorized in-room moderation action.')`,
      [randomUUID(), member.actor_role, input.block ? 'ROOM_MEMBER_BLOCKED' : 'ROOM_MEMBER_KICKED', member.target_id, input.roomCode, Boolean(input.block)],
    );
    return { kicked: true, blocked: Boolean(input.block), targetPublicId: input.targetPublicId };
  });
}

export async function finalizeLiveSession(identity: MobileIdentity, roomCode: string) {
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & {
      accounting_id: string; room_id: string; room_type: "LIVE" | "PARTY" | "FACE"; started_at: Date; ended_at: Date;
      status: string; host_application_user_id: string; reward_rule_id: string | null; valid_duration_seconds: number;
      eligible_duration_seconds: number; reward_coins: number; transaction_code: string | null;
      reward_ledger_id: string | null;
      media_publishing: number; last_media_heartbeat_at: Date | null; media_segment_seconds: number;
      valid_media_seconds: number; media_reconnect_grace_seconds: number;
    })[]>(
      `SELECT accounting.id accounting_id, room.id room_id, accounting.room_type, accounting.started_at,
              accounting.status, accounting.host_application_user_id, accounting.reward_rule_id,
              accounting.valid_duration_seconds, accounting.eligible_duration_seconds, accounting.reward_coins,
              accounting.reward_ledger_id,
              accounting.media_publishing, accounting.last_media_heartbeat_at,
              accounting.media_segment_seconds, accounting.valid_media_seconds,
              COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(room_features.setting_value, '$.mediaReconnectGraceSeconds')) AS UNSIGNED), 60) media_reconnect_grace_seconds,
              ledger.transaction_code,
              COALESCE(room.ended_at, accounting.ended_at, CURRENT_TIMESTAMP(3)) ended_at
       FROM live_session_accounting accounting INNER JOIN live_rooms room ON room.id = accounting.room_id
       LEFT JOIN ledger_transactions ledger ON ledger.id = accounting.reward_ledger_id
       LEFT JOIN system_settings room_features ON room_features.setting_key = 'mobile.room_features'
       WHERE room.room_code = ? LIMIT 1 FOR UPDATE`,
      [roomCode],
    );
    const session = rows[0];
    if (!session || session.host_application_user_id !== identity.userId) throw new Error("Only the room owner can finalize this Live session.");
    if (session.status !== "ACTIVE") {
      return {
        transactionId: session.transaction_code,
        roomType: session.room_type.toLowerCase(),
        validSeconds: Number(session.valid_duration_seconds ?? 0),
        eligibleSeconds: Number(session.eligible_duration_seconds ?? 0),
        rewardCoins: Number(session.reward_coins ?? 0),
        alreadyFinalized: true,
      };
    }
    const reconnectGrace = Math.max(5, Math.min(300, Number(session.media_reconnect_grace_seconds ?? 180)));
    const [heartbeatRows] = await connection.query<(RowDataPacket & { seconds: number })[]>(
      "SELECT GREATEST(0, TIMESTAMPDIFF(SECOND, ?, CURRENT_TIMESTAMP(3))) seconds",
      [session.last_media_heartbeat_at ?? session.started_at],
    );
    const heartbeatGap = Number(heartbeatRows[0]?.seconds ?? 0);
    const finalDelta = Boolean(session.media_publishing) && heartbeatGap <= reconnectGrace ? heartbeatGap : 0;
    const finalSegmentSeconds = Number(session.media_segment_seconds ?? 0) + finalDelta;
    const validSeconds = Number(session.valid_media_seconds ?? 0) + finalDelta;
    const bankedEligibleSeconds = Number(session.eligible_duration_seconds ?? 0);
    const [ruleRows] = await connection.query<(RowDataPacket & { id: string; coins_per_hour: number; minimum_eligible_seconds: number })[]>(
      session.reward_rule_id
        ? "SELECT id, coins_per_hour, minimum_eligible_seconds FROM host_reward_rules WHERE id = ? LIMIT 1"
        : `SELECT id, coins_per_hour, minimum_eligible_seconds FROM host_reward_rules
           WHERE room_type = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1`,
      session.reward_rule_id ? [session.reward_rule_id] : [session.room_type, session.started_at],
    );
    const rule = ruleRows[0];
    if (!rule) throw new Error("The host reward rule is unavailable.");
    const totalEligibleSeconds = bankedEligibleSeconds + Math.floor(finalSegmentSeconds / 3600) * 3600;
    const completedHours = totalEligibleSeconds >= Math.max(3600, Number(rule.minimum_eligible_seconds))
      ? Math.floor(totalEligibleSeconds / 3600)
      : 0;
    // Only whole, continuous hours qualify. An unfinished hour is intentionally
    // discarded when the Live ends (59m = 0, 60m = 3,500, 120m = 7,000).
    const eligibleSeconds = completedHours * 3600;
    const rewardCoins = session.room_type === "PARTY" ? 0 : completedHours * Number(rule.coins_per_hour);
    const newlyEarnedDiamonds = Math.max(0, rewardCoins - Number(session.reward_coins ?? 0));
    let ledgerId: string | null = session.reward_ledger_id ?? null;
    let rewardCode: string | null = session.transaction_code ?? null;
    if (newlyEarnedDiamonds > 0) {
      await ensureWallet(connection, identity.userId, "DIAMOND");
      ledgerId = randomUUID(); rewardCode = code("HST");
      await connection.execute("UPDATE wallet_balances SET available_balance = available_balance + ? WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'DIAMOND'", [newlyEarnedDiamonds, identity.userId]);
      await connection.execute(
        `INSERT INTO ledger_transactions
          (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, destination_type, destination_id, amount, status, reason)
         VALUES (?, ?, ?, 'DIAMOND', 'HOST_HOURLY_DIAMONDS', 'SYSTEM', 'APPLICATION_USER', ?, ?, 'COMPLETED', ?)`,
        [ledgerId, rewardCode, `HOST-FINAL:${session.accounting_id}:${completedHours}`, identity.userId, newlyEarnedDiamonds, `${session.room_type} • ${completedHours} completed continuous hour(s)`],
      );
    }
    await connection.execute(
      `UPDATE live_session_accounting SET ended_at = ?, valid_duration_seconds = ?, eligible_duration_seconds = ?,
       media_publishing = FALSE, last_media_heartbeat_at = CURRENT_TIMESTAMP(3), media_segment_seconds = 0,
       valid_media_seconds = ?, reward_rule_id = ?, reward_coins = ?, reward_ledger_id = ?,
       status = 'FINALIZED', finalized_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      [session.ended_at, validSeconds, eligibleSeconds, validSeconds, rule.id, rewardCoins, ledgerId, session.accounting_id],
    );
    await connection.execute(
      "UPDATE live_room_members SET left_at = COALESCE(left_at, CURRENT_TIMESTAMP(3)), muted = TRUE, media_publishing = FALSE WHERE room_id = ?",
      [session.room_id],
    );
    await connection.execute("UPDATE live_media_access_grants SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3)) WHERE room_id = ?", [session.room_id]);
    await connection.execute("UPDATE live_media_usage SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3)) WHERE room_id = ?", [session.room_id]);
    await connection.execute(
      "UPDATE live_cohost_requests SET status = 'ENDED', ended_at = CURRENT_TIMESTAMP(3) WHERE room_id = ? AND status IN ('PENDING','ACCEPTED')",
      [session.room_id],
    );
    await connection.execute("UPDATE live_rooms SET status = 'ENDED', ended_at = COALESCE(ended_at, ?), audience_count = 0 WHERE id = ?", [session.ended_at, session.room_id]);
    return { transactionId: rewardCode, roomType: session.room_type.toLowerCase(), validSeconds, eligibleSeconds, rewardCoins, rewardDiamonds: rewardCoins, completedHours };
  });
}

export async function submitAutomaticFaceVerification(identity: MobileIdentity, input: { framesBase64: string[]; consentVersion: string }) {
  const frames = input.framesBase64.map((frame) => Buffer.from(frame, "base64"));
  const result = await new FaceBiometricService().verify({ subjectId: identity.userId, consentVersion: input.consentVersion, frames });
  const requestId = randomUUID();
  const retained = result.retainReferenceImage
    ? await preparePrivateDocument(new File([Uint8Array.from(frames[0])], "face-reference.jpg", { type: "image/jpeg" }), randomUUID(), "FACE_REFERENCE", 3 * 1024 * 1024)
    : null;
  await withTransaction(async (connection) => {
    const [currentUsers] = await connection.query<(RowDataPacket & { face_verification_status: string })[]>(
      "SELECT face_verification_status FROM application_users WHERE id = ? LIMIT 1 FOR UPDATE",
      [identity.userId],
    );
    if (!currentUsers[0]) throw new Error("User account was not found.");
    // A later retry must never silently undo a completed panel approval.
    const effectiveStatus = currentUsers[0].face_verification_status === "VERIFIED" ? "VERIFIED" : result.status;
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
      [requestId, identity.userId, retained?.id ?? null, effectiveStatus, result.provider, result.providerFaceId,
        result.embeddingReference, result.livenessScore, result.matchScore, duplicateUserId,
        effectiveStatus === "VERIFIED" ? new Date() : null, result.reason],
    );
    const verified = effectiveStatus === "VERIFIED" ? 1 : 0;
    await connection.execute(
      `UPDATE application_users
       SET face_verification_status = ?,
           agency_face_live_authorized = ?,
           super_admin_face_live_authorized = ?
       WHERE id = ?`,
      [effectiveStatus, verified, verified, identity.userId],
    );
    await connection.execute(
      `INSERT INTO host_profiles (id, application_user_id, agency_account_id, status, verification_status)
       SELECT UUID(), user.id, user.agency_account_id, 'ACTIVE', ?
       FROM application_users user WHERE user.id = ?
       ON DUPLICATE KEY UPDATE verification_status = VALUES(verification_status)`,
      [effectiveStatus === "VERIFIED" ? "VERIFIED" : "PENDING", identity.userId],
    );
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
  return period === "daily" ? "CURRENT_DATE"
    : period === "weekly" ? "DATE_SUB(CURRENT_DATE, INTERVAL WEEKDAY(CURRENT_DATE) DAY)"
      : "DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')";
}

async function leaderboardFor(period: "daily" | "weekly" | "monthly") {
  const start = periodStart(period);
  const [gifters, hosts, agencies] = await Promise.all([
    db().query<RowDataPacket[]>(
      `SELECT user.public_id, user.full_name, user.avatar_url, avatar.updated_at avatar_updated_at,
              user.country_code, user.language_code, user.consumption_points, user.anchor_income_points,
              user.vip_tier, user.is_host, SUM(ledger.amount) score
       FROM ledger_transactions ledger INNER JOIN application_users user ON user.id = ledger.source_id
       LEFT JOIN application_user_avatars avatar ON avatar.application_user_id = user.id
       WHERE ledger.transaction_type = 'GIFT_SPEND' AND ledger.status = 'COMPLETED' AND ledger.created_at >= ${start}
       GROUP BY user.id, user.public_id, user.full_name, user.avatar_url, avatar.updated_at,
                user.country_code, user.language_code, user.consumption_points, user.anchor_income_points, user.vip_tier, user.is_host
       ORDER BY score DESC, user.public_id LIMIT 50`,
    ),
    db().query<RowDataPacket[]>(
      `SELECT user.public_id, user.full_name, user.avatar_url, avatar.updated_at avatar_updated_at,
              user.country_code, user.language_code, user.consumption_points, user.anchor_income_points,
              user.vip_tier, user.is_host, SUM(ledger.amount) score
       FROM ledger_transactions ledger INNER JOIN application_users user ON user.id = ledger.destination_id
       LEFT JOIN application_user_avatars avatar ON avatar.application_user_id = user.id
       WHERE ledger.transaction_type = 'GIFT_RECEIVE' AND ledger.status = 'COMPLETED' AND ledger.created_at >= ${start}
       GROUP BY user.id, user.public_id, user.full_name, user.avatar_url, avatar.updated_at,
                user.country_code, user.language_code, user.consumption_points, user.anchor_income_points, user.vip_tier, user.is_host
       ORDER BY score DESC, user.public_id LIMIT 50`,
    ),
    db().query<RowDataPacket[]>(
      `SELECT agency.public_id, agency.full_name, agency.country_code, creation.id logo_id, SUM(ledger.amount) score
       FROM ledger_transactions ledger INNER JOIN application_users user ON user.id = ledger.destination_id
       INNER JOIN platform_accounts agency ON agency.id = user.agency_account_id
       LEFT JOIN agency_creation_applications creation ON creation.approved_agency_account_id = agency.id AND creation.status = 'APPROVED'
       WHERE ledger.transaction_type = 'GIFT_RECEIVE' AND ledger.status = 'COMPLETED' AND ledger.created_at >= ${start}
       GROUP BY agency.id, agency.public_id, agency.full_name, agency.country_code, creation.id
       ORDER BY score DESC, agency.public_id LIMIT 50`,
    ),
  ]);
  const users = (rows: RowDataPacket[], role: "user" | "host") => rows.map((row, index) => {
    const score = Number(row.score);
    const weeklyRewardRate = period === "weekly" && index < 3 ? [0.025, 0.015, 0.01][index] : 0;
    return {
      rank: index + 1,
      user: {
        id: String(row.public_id), name: String(row.full_name),
        avatarUrl: row.avatar_updated_at == null ? row.avatar_url : `https://nazraa.vercel.app/api/v1/mobile/avatar/${row.public_id}?v=${new Date(row.avatar_updated_at as Date).getTime()}`,
        country: row.country_code ?? "", language: row.language_code ?? "", level: Math.max(1, Math.min(120, Math.floor(Math.sqrt(Number(row.consumption_points ?? 0) / 5000)) + 1)),
        anchorLevel: Math.max(1, Math.min(200, Math.floor(Math.sqrt(Number(row.anchor_income_points ?? 0) / 10000)) + 1)),
        vip: Number(row.vip_tier), role,
      },
      score, label: period,
      rewardCoins: weeklyRewardRate === 0 ? 0 : Math.floor(score * weeklyRewardRate),
    };
  });
  return {
    topGifters: users(gifters[0], "user"), topHosts: users(hosts[0], "host"),
    topAgencies: agencies[0].map((row, index) => ({
      rank: index + 1,
      agency: {
        id: String(row.public_id), code: String(row.public_id), name: String(row.full_name), country: row.country_code ?? "",
        logoUrl: row.logo_id == null ? null : `https://nazraa.vercel.app/api/v1/assets/agencies/${row.public_id}`,
        ownerUserId: "0", status: "ACTIVE", hosts: [], targetProgress: 0,
        estimatedEarnings: Number(row.score), totalLiveMinutes: 0,
      },
      score: Number(row.score), label: period,
    })),
  };
}

export async function mobileCompletionSnapshot(identity: MobileIdentity) {
  // This lightweight, idempotent settlement makes the previous calendar
  // week's payout automatic even on deployments without a separate cron.
  await settlePreviousWeeklyGifterRewards();
  const [rewardRules, claimRows, conversionRows, exchangeRows, rewardHistoryRows, policyRows, discoveryRows, avatarRows, leaderboards, agencyApplications, agencyManagement, posts, privateMessaging, vip, pkStreak] = await Promise.all([
    db().query<RowDataPacket[]>("SELECT day_number, reward_coins, label FROM daily_reward_rules WHERE enabled = TRUE ORDER BY day_number"),
    db().query<RowDataPacket[]>("SELECT DATE_FORMAT(claim_date, '%Y-%m-%d') claim_date, streak_day, reward_coins, claim_code, claimed_at FROM daily_reward_claims WHERE application_user_id = ? ORDER BY claim_date DESC LIMIT 31", [identity.userId]),
    db().query<RowDataPacket[]>("SELECT id, diamonds, coins, minimum_diamonds, maximum_diamonds, effective_from FROM diamond_conversion_rules WHERE enabled = TRUE AND effective_from <= CURRENT_TIMESTAMP(3) ORDER BY effective_from DESC LIMIT 1"),
    db().query<RowDataPacket[]>("SELECT exchange_code, diamonds_debited, coins_credited, created_at FROM diamond_coin_exchanges WHERE application_user_id = ? ORDER BY created_at DESC LIMIT 50", [identity.userId]),
    db().query<RowDataPacket[]>("SELECT room_type, started_at, ended_at, valid_duration_seconds, eligible_duration_seconds, reward_coins, status FROM live_session_accounting WHERE host_application_user_id = ? ORDER BY started_at DESC LIMIT 50", [identity.userId]),
    db().query<RowDataPacket[]>("SELECT policy_key, version, title, summary, body_json, effective_from FROM policy_documents WHERE active = TRUE AND effective_from <= CURRENT_TIMESTAMP(3) ORDER BY policy_key, effective_from DESC"),
    db().query<(RowDataPacket & { setting_value: unknown })[]>("SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.discovery' LIMIT 1"),
    db().query<RowDataPacket[]>("SELECT updated_at FROM application_user_avatars WHERE application_user_id = ? LIMIT 1", [identity.userId]),
    Promise.all([leaderboardFor("daily"), leaderboardFor("weekly"), leaderboardFor("monthly")]),
    agencyApplicationsForUser(identity),
    agencyOwnerSnapshot(identity),
    discoveryPosts(),
    privateMessagingForUser(identity),
    vipSnapshot(identity),
    pkStreakSnapshot(identity),
  ]);
  const claims = claimRows[0];
  const lastClaimDate = claims[0]?.claim_date ? String(claims[0].claim_date).slice(0, 10) : null;
  const [clockRows] = await db().query<(RowDataPacket & { today: string })[]>("SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d') today");
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
    vip,
    pkStreak,
    agencyApplications,
    agencyManagement,
    posts,
    privateMessaging,
  };
}
