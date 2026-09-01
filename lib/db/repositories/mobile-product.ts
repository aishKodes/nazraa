import "server-only";

import { randomInt, randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db, withDatabaseReadRetry } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { publicImageFromDataUrl } from "@/lib/security/public-images";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { permissionsForMobileRole } from "@/lib/auth/mobile-session";
import { encryptPrivateText } from "@/lib/security/documents";
import { mobileCompletionSnapshot } from "@/lib/db/repositories/mobile-completion";
import { recordRocketGift } from "@/lib/db/repositories/mobile-rewards";
import { LiveAccessPolicyService } from "@/lib/services/live-access-policy";
import { runMonthlyHostEarningsReset } from "@/lib/db/repositories/monthly-host-reset";
import { mobileGamesConfig, type GameRuntimeConfig } from "@/lib/games/game-config";

function code(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function levelProgress(totalPoints: number, track: "consumption" | "anchorIncome", maximumLevel = track === "anchorIncome" ? 200 : 120) {
  const level = Math.min(maximumLevel, Math.floor(Math.sqrt(Math.max(0, totalPoints) / 500)) + 1);
  const start = (level - 1) * (level - 1) * 500;
  const end = level * level * 500;
  return {
    track,
    totalPoints,
    level,
    pointsIntoLevel: Math.max(0, totalPoints - start),
    pointsForNextLevel: level >= maximumLevel ? 0 : end - start,
  };
}

function productRole(platformRole: unknown, isHost: unknown) {
  return switchRole(String(platformRole ?? ""), Boolean(isHost));
}

function giftSymbol(key: string, name: string) {
  const value = `${key} ${name}`.toLowerCase();
  if (value.includes("rose")) return "🌹";
  if (value.includes("heart") || value.includes("love")) return "💖";
  if (value.includes("coffee") || value.includes("tea")) return "☕";
  if (value.includes("crown")) return "👑";
  if (value.includes("rocket")) return "🚀";
  if (value.includes("star")) return "🌟";
  if (value.includes("diamond")) return "💎";
  return "🎁";
}

function switchRole(role: string, isHost: boolean) {
  if (role === "AGENCY") return "agency_owner";
  if (role === "COIN_SELLER") return "coin_seller";
  if (role === "MONITORING_CS") return "monitoring_cs";
  if (role === "ADMIN" || role === "BD" || role === "COUNTRY_MANAGER") return "admin";
  if (role === "SUPER_ADMIN") return "super_admin";
  if (role === "MASTER") return "master";
  return isHost ? "host" : "user";
}

function mobileAvatarUrl(row: RowDataPacket, prefix = "") {
  const publicId = row[`${prefix}public_id`];
  const uploadedAt = row[`${prefix}avatar_updated_at`];
  if (publicId != null && uploadedAt != null) {
    return `https://nazraa.vercel.app/api/v1/mobile/avatar/${publicId}?v=${new Date(uploadedAt as string | Date).getTime()}`;
  }
  return row[`${prefix}avatar_url`] ?? null;
}

async function pruneInactiveRooms() {
  await withTransaction(async (connection) => {
    const [staleRows] = await connection.query<(RowDataPacket & { id: string })[]>(
      `SELECT room.id FROM live_rooms room
       WHERE room.status IN ('ACTIVE','LOCKED')
         AND NOT EXISTS (
           SELECT 1 FROM live_room_members active_member
           WHERE active_member.room_id = room.id AND active_member.left_at IS NULL
             AND active_member.last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 10 MINUTE
         ) FOR UPDATE`,
    );
    if (!staleRows.length) return;
    const ids = staleRows.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(",");
    await connection.execute(
      `UPDATE live_room_members SET left_at = COALESCE(left_at, CURRENT_TIMESTAMP(3)), muted = TRUE WHERE room_id IN (${placeholders})`,
      ids,
    );
    await connection.execute(
      `UPDATE live_rooms SET status = 'ENDED', ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3)), audience_count = 0 WHERE id IN (${placeholders})`,
      ids,
    );
    await connection.execute(
      `UPDATE live_session_accounting SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3)), status = IF(status = 'ACTIVE', 'VOID', status) WHERE room_id IN (${placeholders})`,
      ids,
    );
  });
}

async function settingsMap() {
  const [rows] = await db().query<(RowDataPacket & { setting_key: string; setting_value: unknown })[]>(
    "SELECT setting_key, setting_value FROM system_settings",
  );
  return Object.fromEntries(rows.map((row) => [row.setting_key, asObject(row.setting_value)]));
}


async function activeRoomRows(after?: string) {
  return db().query<RowDataPacket[]>(
      `SELECT room.id, room.room_code, room.room_type, room.title, room.category, room.language_code,
              room.privacy, room.seat_count, room.theme_index, room.room_photo_asset_id, room.country_code,
              room.password_hash, room.chat_locked, room.interactions_enabled, room.theme_enabled, room.pk_requests_enabled,
              top_user.public_id top_public_id, top_user.full_name top_name, top_user.avatar_url top_avatar_url,
              top_avatar.updated_at top_avatar_updated_at,
              top_user.country_code top_country, top_user.language_code top_language,
              top_user.anchor_income_points top_anchor_points, top_user.level_number top_level, top_user.vip_tier top_vip,
              room.status, (SELECT COUNT(*) FROM live_room_members recent WHERE recent.room_id = room.id AND recent.left_at IS NULL AND recent.last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 2 MINUTE) audience_count,
              user.public_id host_public_id, user.full_name host_name, user.anchor_income_points host_anchor_points, user.level_number host_level,
              user.vip_tier host_vip, user.avatar_url host_avatar_url, host_avatar.updated_at host_avatar_updated_at, user.country_code host_country,
              user.language_code host_language,
              (SELECT operator.role FROM platform_accounts operator
               WHERE operator.status = 'ACTIVE' AND
                 (operator.application_user_id = user.id OR operator.application_user_id = user.external_user_id
                  OR operator.application_user_id = CAST(user.public_id AS CHAR))
               ORDER BY operator.created_at LIMIT 1) host_platform_role,
              account.public_id agency_public_id, account.full_name agency_name
       FROM live_rooms room INNER JOIN application_users user ON user.id = room.host_application_user_id
       LEFT JOIN application_user_avatars host_avatar ON host_avatar.application_user_id = user.id
       LEFT JOIN application_users top_user ON top_user.id = room.top_application_user_id
       LEFT JOIN application_user_avatars top_avatar ON top_avatar.application_user_id = top_user.id
       LEFT JOIN platform_accounts account ON account.id = room.agency_account_id
       WHERE room.status IN ('ACTIVE','LOCKED')
         AND EXISTS (SELECT 1 FROM live_room_members active_member WHERE active_member.room_id = room.id AND active_member.left_at IS NULL AND active_member.last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 10 MINUTE)
       ${after ? "AND (room.started_at, room.id) < (SELECT started_at, id FROM live_rooms WHERE room_code = ?)" : ""}
       ORDER BY room.started_at DESC, room.id DESC LIMIT 30`, after ? [after] : [],
    );
}

function mapActiveRoom(row: RowDataPacket, maximumLevel = 200) {
  return {
    id: String(row.room_code), title: String(row.title), category: String(row.category),
    language: String(row.language_code), listeners: Number(row.audience_count), themeIndex: Number(row.theme_index ?? 0), privacy: String(row.privacy).toLowerCase(),
    seatCount: Number(row.seat_count), kind: row.room_type === "PARTY" ? "party" : row.room_type === "FACE" ? "face" : "live", isActive: true,
    photoUrl: row.room_photo_asset_id == null ? null : `https://nazraa.vercel.app/api/v1/assets/rooms/${row.room_photo_asset_id}`,
    passwordRequired: row.password_hash != null,
    chatLocked: Boolean(row.chat_locked), interactionsEnabled: Boolean(row.interactions_enabled),
    themeEnabled: Boolean(row.theme_enabled),
    pkRequestsEnabled: Boolean(row.pk_requests_enabled),
    countryCode: row.country_code,
    agencyId: row.agency_public_id == null ? null : String(row.agency_public_id), agencyName: row.agency_name,
    host: { id: String(row.host_public_id), name: String(row.host_name), avatarUrl: mobileAvatarUrl(row, "host_"),
      country: row.host_country ?? "", language: row.host_language ?? "", level: Number(row.host_level), anchorLevel: levelProgress(Number(row.host_anchor_points ?? 0), "anchorIncome", maximumLevel).level,
      vip: Number(row.host_vip), role: productRole(row.host_platform_role, true) },
    topUser: row.top_public_id == null ? null : {
      id: String(row.top_public_id), name: String(row.top_name), avatarUrl: mobileAvatarUrl(row, "top_"),
      country: row.top_country ?? "", language: row.top_language ?? "", level: Number(row.top_level), anchorLevel: levelProgress(Number(row.top_anchor_points ?? 0), "anchorIncome", maximumLevel).level,
      vip: Number(row.top_vip), role: "user",
    },
    managers: [], participants: [], giftEvents: [],
  };
}

export async function activeRoomPage(after?: string) {
  return withDatabaseReadRetry(async () => {
    const [rows] = await activeRoomRows(after);
    return rows.map((row) => mapActiveRoom(row));
  });
}

async function mobileBootstrapOnce(identity: MobileIdentity) {
  await pruneInactiveRooms();
  const [
    profileRows,
    walletRows,
    transactionRows,
    roomRows,
    peopleRows,
    giftRows,
    bannerRows,
    platformNotificationRows,
    mobileNotificationRows,
    packageRows,
    sellerRows,
    orderRows,
    payoutRows,
    withdrawalRows,
    followUserRows,
    followAgencyRows,
    agencyRows,
    hostRows,
    rankingRows,
    agencyRankingRows,
    hostRewardRuleRows,
    settings,
    completion,
  ] = await Promise.all([
    db().query<(RowDataPacket & {
      public_id: number; full_name: string; avatar_url: string | null; country_code: string | null;
      date_of_birth: string | null; gender: string | null; bio: string; language_code: string; whatsapp_e164: string | null;
      level_number: number; vip_tier: number; consumption_points: number; anchor_income_points: number;
      face_verification_status: string; is_host: number;
    })[]>("SELECT public_id, full_name, avatar_url, country_code, date_of_birth, gender, bio, language_code, whatsapp_e164, level_number, vip_tier, consumption_points, anchor_income_points, face_verification_status, is_host FROM application_users WHERE id = ? LIMIT 1", [identity.userId]),
    db().query<(RowDataPacket & { asset_type: string; available_balance: number; reserved_balance: number })[]>("SELECT asset_type, available_balance, reserved_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ?", [identity.userId]),
    db().query<RowDataPacket[]>(
      `SELECT id, transaction_code, asset_type, transaction_type, source_id, destination_type, destination_id, amount, reason, created_at
       FROM ledger_transactions
       WHERE (source_type = 'APPLICATION_USER' AND source_id = ? AND transaction_type <> 'GIFT_RECEIVE')
          OR (destination_type = 'APPLICATION_USER' AND destination_id = ? AND transaction_type <> 'GIFT_SPEND')
       ORDER BY created_at DESC LIMIT 100`,
      [identity.userId, identity.userId],
    ),
    activeRoomRows(),
    db().query<RowDataPacket[]>(
      `SELECT user.public_id, user.full_name, user.avatar_url, avatar.updated_at avatar_updated_at, user.country_code, user.language_code,
              user.level_number, user.anchor_income_points, user.vip_tier, user.is_host,
              account.role platform_role
       FROM application_users user
       LEFT JOIN application_user_avatars avatar ON avatar.application_user_id = user.id
       LEFT JOIN platform_accounts account ON account.status = 'ACTIVE'
        AND (account.application_user_id = user.id OR account.application_user_id = user.external_user_id OR account.application_user_id = CAST(user.public_id AS CHAR))
       WHERE user.account_status = 'ACTIVE' ORDER BY user.last_active_at DESC LIMIT 80`,
    ),
    db().query<RowDataPacket[]>("SELECT gift_key, name, category, emoji, coin_price, visual_url, animation_key FROM gift_catalog WHERE active = TRUE ORDER BY coin_price, name"),
    db().query<RowDataPacket[]>(
      `SELECT id, placement, title, subtitle, image_url, action_type, action_target, priority, starts_at, ends_at
       FROM banners WHERE active = TRUE AND (starts_at IS NULL OR starts_at <= CURRENT_TIMESTAMP(3))
       AND (ends_at IS NULL OR ends_at > CURRENT_TIMESTAMP(3)) ORDER BY priority DESC`,
    ),
    db().query<RowDataPacket[]>(
      `SELECT id, title, message, action_target,
              COALESCE(published_at, scheduled_at, created_at) created_at,
              ROUND(UNIX_TIMESTAMP(COALESCE(published_at, scheduled_at, created_at)) * 1000) created_at_epoch_ms
       FROM platform_notifications WHERE (status = 'PUBLISHED' OR (status = 'SCHEDULED' AND scheduled_at <= CURRENT_TIMESTAMP(3)))
       AND (audience_role IS NULL OR audience_role IN (?, 'ALL')) ORDER BY created_at DESC LIMIT 40`,
      [identity.role],
    ),
    db().query<RowDataPacket[]>(
      `SELECT id, notification_type, title, message, action_target, read_at, created_at,
              ROUND(UNIX_TIMESTAMP(created_at) * 1000) created_at_epoch_ms
       FROM mobile_notifications WHERE application_user_id = ? ORDER BY created_at DESC LIMIT 60`,
      [identity.userId],
    ),
    db().query<RowDataPacket[]>("SELECT id, public_id, name, badge_label, coin_amount, display_price, currency, sort_order FROM coin_packages WHERE active = TRUE ORDER BY sort_order, coin_amount"),
    db().query<RowDataPacket[]>(
      `SELECT account.id, account.public_id, account.full_name, account.country_code, profile.business_whatsapp_e164,
              profile.availability_status, profile.supported_region, profile.verification_status,
              (SELECT COUNT(*) FROM coin_purchase_requests request WHERE request.seller_account_id = account.id AND request.status = 'COMPLETED') fulfilled_orders
       FROM platform_accounts account INNER JOIN seller_profiles profile ON profile.account_id = account.id
       WHERE account.role IN ('AGENCY','COIN_SELLER') AND account.status = 'ACTIVE'
       AND profile.verification_status = 'VERIFIED' AND profile.available_for_sales = TRUE
       AND profile.whatsapp_public = TRUE AND profile.business_whatsapp_e164 IS NOT NULL
       AND EXISTS (SELECT 1 FROM seller_package_support support INNER JOIN coin_packages package ON package.id = support.coin_package_id WHERE support.seller_account_id = account.id AND support.active = TRUE AND package.active = TRUE)
       ORDER BY profile.availability_status = 'AVAILABLE' DESC, account.full_name`,
    ),
    db().query<RowDataPacket[]>(
      `SELECT request.public_id, package.public_id package_public_id, seller.public_id seller_public_id,
              request.coin_amount, package.display_price, request.status, request.created_at
       FROM coin_purchase_requests request INNER JOIN coin_packages package ON package.id = request.coin_package_id
       INNER JOIN platform_accounts seller ON seller.id = request.seller_account_id
       WHERE request.application_user_id = ? ORDER BY request.created_at DESC LIMIT 50`,
      [identity.userId],
    ),
    db().query<RowDataPacket[]>("SELECT id, method_type, display_name, masked_destination, verified FROM payout_methods WHERE application_user_id = ? AND active = TRUE ORDER BY created_at", [identity.userId]),
    db().query<RowDataPacket[]>(
      "SELECT id, withdrawal_code, amount, status, requested_at, payout_method_masked, payout_method_id, review_reason FROM withdrawal_requests WHERE application_user_id = ? ORDER BY requested_at DESC LIMIT 50",
      [identity.userId],
    ),
    db().query<RowDataPacket[]>(
      `SELECT followed.public_id FROM user_follows follow_link INNER JOIN application_users followed ON followed.id = follow_link.followed_application_user_id
       WHERE follow_link.follower_application_user_id = ?`,
      [identity.userId],
    ),
    db().query<RowDataPacket[]>(
      `SELECT account.public_id FROM agency_follows follow_link INNER JOIN platform_accounts account ON account.id = follow_link.agency_account_id
       WHERE follow_link.application_user_id = ?`,
      [identity.userId],
    ),
    db().query<RowDataPacket[]>(
      `SELECT account.id, account.public_id, account.full_name, account.status, account.country_code,
              owner.public_id owner_public_id, owner.full_name owner_name,
              COUNT(host.id) host_count, COALESCE(SUM(host.live_minutes_30d), 0) total_live_minutes,
              COALESCE(SUM(host.gifts_value_30d), 0) estimated_earnings
       FROM application_users user INNER JOIN platform_accounts account ON account.id = user.agency_account_id
       LEFT JOIN application_users owner
         ON owner.id = account.application_user_id
         OR owner.external_user_id = account.application_user_id
         OR CAST(owner.public_id AS CHAR) = account.application_user_id
       LEFT JOIN host_profiles host ON host.agency_account_id = account.id
       WHERE user.id = ? GROUP BY account.id, account.public_id, account.full_name, account.status, account.country_code, owner.public_id, owner.full_name LIMIT 1`,
      [identity.userId],
    ),
    db().query<RowDataPacket[]>(
      `SELECT host.id, host.status, agency.full_name agency_name, host.live_minutes_30d,
              host.sessions_30d, host.gifts_value_30d, user.anchor_income_points
       FROM host_profiles host INNER JOIN application_users user ON user.id = host.application_user_id
       LEFT JOIN platform_accounts agency ON agency.id = host.agency_account_id WHERE user.id = ? LIMIT 1`,
      [identity.userId],
    ),
    db().query<RowDataPacket[]>("SELECT public_id, full_name, level_number, vip_tier, consumption_points FROM application_users WHERE account_status = 'ACTIVE' ORDER BY consumption_points DESC, created_at ASC LIMIT 50"),
    db().query<RowDataPacket[]>(
      `SELECT account.public_id, account.full_name, COALESCE(SUM(host.gifts_value_30d), 0) score
       FROM platform_accounts account LEFT JOIN host_profiles host ON host.agency_account_id = account.id
       WHERE account.role = 'AGENCY' AND account.status = 'ACTIVE' GROUP BY account.id, account.public_id, account.full_name
       ORDER BY score DESC, account.created_at ASC LIMIT 50`,
    ),
    db().query<RowDataPacket[]>(
      `SELECT room_type, coins_per_hour, minimum_eligible_seconds
       FROM host_reward_rules
       WHERE enabled = TRUE AND effective_from <= CURRENT_TIMESTAMP(3)
       ORDER BY FIELD(room_type, 'LIVE', 'FACE', 'PARTY'), effective_from DESC`,
    ),
    settingsMap(),
    mobileCompletionSnapshot(identity),
  ]);

  const profile = profileRows[0][0];
  if (!profile) throw new Error("Mobile profile was not found.");
  const wallets = walletRows[0];
  const coins = Number(wallets.find((item) => item.asset_type === "COIN")?.available_balance ?? 0);
  const diamondWallet = wallets.find((item) => item.asset_type === "DIAMOND");
  const diamonds = Number(diamondWallet?.available_balance ?? 0);
  const reservedDiamonds = Number(diamondWallet?.reserved_balance ?? 0);
  const levelConfig = settings["mobile.levels"] ?? {};
  const maximumConsumptionLevel = Number(levelConfig.maximumConsumptionLevel ?? levelConfig.maximumLevel ?? 120);
  const maximumActorLevel = Number(levelConfig.maximumActorLevel ?? 200);
  const commerce = settings["mobile.commerce"] ?? {};

  const usersByName = new Map<string, { id: string; name: string; level: number; vip: number }>();
  for (const item of peopleRows[0]) usersByName.set(String(item.public_id), { id: String(item.public_id), name: String(item.full_name), level: Number(item.level_number), vip: Number(item.vip_tier) });

  const rooms = roomRows[0].map((row) => mapActiveRoom(row, maximumActorLevel));

  const currentAgency = agencyRows[0][0];
  const currentHost = hostRows[0][0];
  const roleName = identity.role.toLowerCase();
  return {
    ...completion,
    serverTime: new Date().toISOString(),
    environment: "production",
    profile: {
      id: String(profile.public_id), name: profile.full_name,
      avatarUrl: completion.profileAvatarVersion
        ? `https://nazraa.vercel.app/api/v1/mobile/avatar/${profile.public_id}?v=${completion.profileAvatarVersion}`
        : profile.avatar_url,
      country: profile.country_code ?? "", language: profile.language_code, bio: profile.bio,
      gender: profile.gender?.toString().toLowerCase() ?? null, dateOfBirth: profile.date_of_birth,
      whatsappE164: profile.whatsapp_e164, level: levelProgress(Number(profile.consumption_points), "consumption", maximumConsumptionLevel).level, anchorLevel: levelProgress(Number(profile.anchor_income_points), "anchorIncome", maximumActorLevel).level,
      vip: Number(profile.vip_tier), role: roleName, faceVerificationStatus: String(profile.face_verification_status).toLowerCase(),
      permissions: permissionsForMobileRole(identity.role),
    },
    config: {
      features: settings["mobile.features"] ?? {},
      roomFeatures: settings["mobile.room_features"] ?? {},
      commerce,
      app: settings["mobile.app_config"] ?? {},
      levels: levelConfig,
    },
    wallet: { coins, diamonds, reservedDiamonds, gameCredits: coins },
    transactions: transactionRows[0].map((row) => ({
      id: String(row.transaction_code), title: String(row.reason || row.transaction_type), amount: Number(row.amount),
      createdAt: row.created_at, currency: String(row.asset_type),
      isCredit: row.transaction_type !== "GIFT_SPEND" && row.destination_type === "APPLICATION_USER" && row.destination_id === identity.userId,
      ledger: row.asset_type === "DIAMOND" ? "hostEarnings" : "socialCoins", type: String(row.transaction_type),
    })),
    rooms,
    people: peopleRows[0].map((row) => ({ id: String(row.public_id), name: String(row.full_name), avatarUrl: mobileAvatarUrl(row),
      country: row.country_code ?? "", language: row.language_code ?? "", level: levelProgress(Number(row.consumption_points ?? 0), "consumption", maximumConsumptionLevel).level, anchorLevel: levelProgress(Number(row.anchor_income_points ?? 0), "anchorIncome", maximumActorLevel).level,
      vip: Number(row.vip_tier), role: productRole(row.platform_role, row.is_host) })),
    gifts: giftRows[0].map((row, index) => ({ id: String(row.gift_key), name: String(row.name), symbol: row.emoji ? String(row.emoji) : giftSymbol(String(row.gift_key), String(row.name)), cost: Number(row.coin_price), category: String(row.category), accent: [0xffff4fa2, 0xff9a5cff, 0xffffc857, 0xff4cc9f0][index % 4], visualUrl: row.visual_url, animationKey: row.animation_key })),
    banners: bannerRows[0].map((row) => ({ id: String(row.id), image: String(row.image_url), title: row.title, subtitle: row.subtitle, actionType: String(row.action_type).toLowerCase(), actionTarget: row.action_target, placement: String(row.placement).toLowerCase(), priority: Number(row.priority), startAt: row.starts_at ?? new Date(0).toISOString(), endAt: row.ends_at ?? "2999-12-31T23:59:59.000Z", isActive: true })),
    announcements: [...platformNotificationRows[0], ...mobileNotificationRows[0]].map((row, index) => ({
      id: String(row.id), message: String(row.message), title: row.title,
      kind: row.notification_type ? "system" : "event", actionTarget: row.action_target,
      priority: 100 - index,
      // DATETIME has no timezone. UNIX_TIMESTAMP converts it using the MySQL
      // server/session timezone so clients do not see local DB mail as future.
      startAt: new Date(Number(row.created_at_epoch_ms)).toISOString(),
      endAt: "2999-12-31T23:59:59.000Z", isActive: true,
      // Platform broadcasts are shared and have no per-user read row. Personal
      // mail is unread until this user opens Nazraa Mail.
      read: row.notification_type ? row.read_at != null : true,
    })),
    coinPackages: packageRows[0].map((row) => ({ id: String(row.public_id), name: String(row.name), badge: row.badge_label, coins: Number(row.coin_amount), bonusCoins: 0, pricePaise: Math.round(Number(row.display_price ?? 0) * 100), popular: row.badge_label === "Popular" })),
    coinSellers: sellerRows[0].map((row) => ({ id: String(row.public_id), name: String(row.full_name), whatsappE164: String(row.business_whatsapp_e164), supportUri: `https://wa.me/${String(row.business_whatsapp_e164).replace(/\D/g, "")}`, availability: row.availability_status === "AVAILABLE" ? "available" : "offline", fulfilledOrders: Number(row.fulfilled_orders), rating: 5, supportedRegion: row.supported_region ?? row.country_code ?? "", verified: row.verification_status === "VERIFIED" })),
    coinPurchaseRequests: orderRows[0].map((row) => ({ id: String(row.public_id), userId: identity.publicId, packageId: String(row.package_public_id), sellerId: String(row.seller_public_id), coins: Number(row.coin_amount), pricePaise: Math.round(Number(row.display_price ?? 0) * 100), status: String(row.status).toLowerCase(), createdAt: row.created_at })),
    payoutMethods: payoutRows[0].map((row) => ({ id: String(row.id), type: row.method_type === "UPI" ? "upi" : "bankTransfer", displayName: String(row.display_name), maskedDestination: String(row.masked_destination), verified: Boolean(row.verified) })),
    withdrawalRequests: withdrawalRows[0].map((row) => ({ id: String(row.withdrawal_code), userId: identity.publicId, payoutMethodId: String(row.payout_method_id ?? ""), amount: Number(row.amount), status: String(row.status).toLowerCase(), createdAt: row.requested_at, reviewNote: row.review_reason })),
    minimumWithdrawal: Number(commerce.minimumWithdrawal ?? 1000),
    followedUserIds: followUserRows[0].map((row) => String(row.public_id)),
    followedAgencyIds: followAgencyRows[0].map((row) => String(row.public_id)),
    faceVerificationStatus: String(profile.face_verification_status).toLowerCase(),
    agency: currentAgency ? { id: String(currentAgency.public_id), code: String(currentAgency.public_id), logoUrl: `https://nazraa.vercel.app/api/v1/assets/agencies/${currentAgency.public_id}`, name: String(currentAgency.full_name), country: currentAgency.country_code ?? "", ownerUserId: currentAgency.owner_public_id == null ? "0" : String(currentAgency.owner_public_id), ownerName: currentAgency.owner_name == null ? null : String(currentAgency.owner_name), isOwner: completion.agencyManagement.isOwner, status: String(currentAgency.status), hosts: completion.agencyManagement.hosts, joinRequests: completion.agencyManagement.joinRequests, targetProgress: 0, estimatedEarnings: Number(currentAgency.estimated_earnings), totalLiveMinutes: Number(currentAgency.total_live_minutes), hostCount: Number(currentAgency.host_count) } : null,
    hostProfile: currentHost ? { id: String(currentHost.id), status: String(currentHost.status).toLowerCase(), agencyName: currentHost.agency_name ?? "Independent", level: levelProgress(Number(currentHost.anchor_income_points), "anchorIncome", maximumActorLevel).level, liveMinutes: Number(currentHost.live_minutes_30d), validDays: Number(currentHost.sessions_30d), requiredDays: 15, targetProgress: Math.min(1, Number(currentHost.live_minutes_30d) / 1800), giftEarnings: Number(currentHost.gifts_value_30d), diamonds } : null,
    hostRewardRules: [...new Map(hostRewardRuleRows[0].map((row) => [String(row.room_type), {
      roomType: String(row.room_type).toLowerCase(),
      coinsPerHour: Number(row.coins_per_hour),
      minimumEligibleSeconds: Number(row.minimum_eligible_seconds),
    }])).values()],
    consumptionLevel: levelProgress(Number(profile.consumption_points), "consumption", maximumConsumptionLevel),
    anchorIncomeLevel: levelProgress(Number(profile.anchor_income_points), "anchorIncome", maximumActorLevel),
    rankings: rankingRows[0].map((row, index) => ({ rank: index + 1, user: { id: String(row.public_id), name: String(row.full_name), level: Number(row.level_number), vip: Number(row.vip_tier), role: "user" }, score: Number(row.consumption_points), label: "Consumption" })),
    agencyRankings: agencyRankingRows[0].map((row, index) => ({ rank: index + 1, agency: { id: String(row.public_id), code: String(row.public_id), name: String(row.full_name), country: "", ownerUserId: "0", status: "ACTIVE", hosts: [], targetProgress: 0, estimatedEarnings: Number(row.score), totalLiveMinutes: 0 }, score: Number(row.score), label: "Agency" })),
    posts: completion.posts,
    role: roleName,
    permissions: permissionsForMobileRole(identity.role),
  };
}

export async function mobileBootstrap(identity: MobileIdentity) {
  // The bootstrap is read-only apart from idempotent stale-room pruning, so a
  // cold Hostinger connection may safely be retried as one unit.
  await runMonthlyHostEarningsReset();
  return withDatabaseReadRetry(() => mobileBootstrapOnce(identity));
}

export async function createCoinPurchaseRequest(identity: MobileIdentity, packagePublicId: string, sellerPublicId: string) {
  return withTransaction(async (connection) => {
    const [packages] = await connection.query<(RowDataPacket & { id: string; public_id: number; coin_amount: number; display_price: number | null })[]>("SELECT id, public_id, coin_amount, display_price FROM coin_packages WHERE public_id = ? AND active = TRUE LIMIT 1", [packagePublicId]);
    const coinPackage = packages[0];
    if (!coinPackage) throw new Error("The selected package is no longer available.");
    const [sellers] = await connection.query<(RowDataPacket & { id: string; public_id: number; full_name: string; business_whatsapp_e164: string })[]>(
      `SELECT account.id, account.public_id, account.full_name, profile.business_whatsapp_e164
       FROM platform_accounts account INNER JOIN seller_profiles profile ON profile.account_id = account.id
       INNER JOIN seller_package_support support ON support.seller_account_id = account.id AND support.coin_package_id = ? AND support.active = TRUE
       WHERE account.public_id = ? AND account.status = 'ACTIVE' AND account.role IN ('AGENCY','COIN_SELLER')
       AND profile.verification_status = 'VERIFIED' AND profile.available_for_sales = TRUE
       AND profile.whatsapp_public = TRUE AND profile.business_whatsapp_e164 IS NOT NULL LIMIT 1`,
      [coinPackage.id, sellerPublicId],
    );
    const seller = sellers[0];
    if (!seller) throw new Error("The approved seller no longer supports this package.");
    const id = randomUUID();
    await connection.execute(
      "INSERT INTO coin_purchase_requests (id, application_user_id, seller_account_id, coin_package_id, coin_amount) VALUES (?, ?, ?, ?, ?)",
      [id, identity.userId, seller.id, coinPackage.id, coinPackage.coin_amount],
    );
    const [rows] = await connection.query<(RowDataPacket & { public_id: number; created_at: string })[]>("SELECT public_id, created_at FROM coin_purchase_requests WHERE id = ?", [id]);
    const order = rows[0];
    await connection.execute(
      "INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'COIN_ORDER', 'Coin request created', ?, 'wallet/orders')",
      [randomUUID(), identity.userId, `Order ${order.public_id} is pending contact with ${seller.full_name}.`],
    );
    return { id: String(order.public_id), userId: identity.publicId, packageId: String(coinPackage.public_id), sellerId: String(seller.public_id), coins: Number(coinPackage.coin_amount), pricePaise: Math.round(Number(coinPackage.display_price ?? 0) * 100), status: "pending_contact", createdAt: order.created_at, whatsappE164: seller.business_whatsapp_e164 };
  });
}

export async function createWithdrawalRequest(identity: MobileIdentity, amount: number, payout: {
  type: "UPI"; accountHolderName: string; upiId: string;
} | { type: "BANK"; accountHolderName: string; accountNumber: string; ifsc: string; bankName: string } | { payoutMethodId: string }) {
  const settings = await settingsMap();
  const minimum = Number(settings["mobile.commerce"]?.minimumWithdrawal ?? 1000);
  if (!Number.isSafeInteger(amount) || amount < minimum) throw new Error(`Minimum withdrawal is ${minimum}.`);
  return withTransaction(async (connection) => {
    const [eligibleRows] = await connection.query<RowDataPacket[]>(
      `SELECT user.id FROM application_users user WHERE user.id = ? AND (
         EXISTS (SELECT 1 FROM host_profiles host WHERE host.application_user_id = user.id AND host.status = 'ACTIVE')
         OR EXISTS (SELECT 1 FROM platform_accounts agency WHERE agency.application_user_id = user.id AND agency.role = 'AGENCY' AND agency.status = 'ACTIVE')
       ) LIMIT 1`,
      [identity.userId],
    );
    if (!eligibleRows[0]) throw new Error("Only an active Host or Agency Owner can withdraw earnings.");
    let payoutMethodId: string;
    let masked: string;
    if ("payoutMethodId" in payout) {
      const [methodRows] = await connection.query<(RowDataPacket & { id: string; masked_destination: string })[]>(
        "SELECT id, masked_destination FROM payout_methods WHERE id = ? AND application_user_id = ? AND active = TRUE LIMIT 1 FOR UPDATE",
        [payout.payoutMethodId, identity.userId],
      );
      const method = methodRows[0];
      if (!method) throw new Error("Choose one of your saved payout methods.");
      payoutMethodId = method.id;
      masked = String(method.masked_destination);
    } else {
      const destination = payout.type === "UPI"
        ? `UPI ID: ${payout.upiId}`
        : `Account number: ${payout.accountNumber}\nIFSC: ${payout.ifsc}\nBank: ${payout.bankName}`;
      const lastFour = (payout.type === "UPI" ? payout.upiId : payout.accountNumber).replace(/\s/g, "").slice(-4);
      masked = payout.type === "UPI"
        ? `${payout.upiId.slice(0, 1)}•••${payout.upiId.slice(payout.upiId.indexOf("@"))}`
        : `•••• ${lastFour} • ${payout.ifsc}`;
      const protectedValue = encryptPrivateText(destination);
      payoutMethodId = randomUUID();
      await connection.execute(
        `INSERT INTO payout_methods
          (id, application_user_id, method_type, display_name, masked_destination, destination_encrypted, destination_iv, destination_tag, active, verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, FALSE)`,
        [payoutMethodId, identity.userId, payout.type, payout.accountHolderName, masked, protectedValue.encryptedData, protectedValue.iv, protectedValue.tag],
      );
    }
    await connection.execute("INSERT IGNORE INTO wallet_balances (id, owner_type, owner_id, asset_type) VALUES (?, 'APPLICATION_USER', ?, 'DIAMOND')", [randomUUID(), identity.userId]);
    const [walletRows] = await connection.query<(RowDataPacket & { id: string; available_balance: number; reserved_balance: number })[]>("SELECT id, available_balance, reserved_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'DIAMOND' FOR UPDATE", [identity.userId]);
    const wallet = walletRows[0];
    if (!wallet || Number(wallet.available_balance) < amount) throw new Error("Available host earnings are too low for this request.");
    await connection.execute("UPDATE wallet_balances SET available_balance = available_balance - ?, reserved_balance = reserved_balance + ? WHERE id = ?", [amount, amount, wallet.id]);
    const requestId = randomUUID(); const requestCode = code("WDR");
    await connection.execute(
      `INSERT INTO withdrawal_requests (id, withdrawal_code, application_user_id, agency_account_id, amount, payout_method_masked, payout_method_id)
       SELECT ?, ?, id, agency_account_id, ?, ?, ? FROM application_users WHERE id = ?`,
      [requestId, requestCode, amount, masked, payoutMethodId, identity.userId],
    );
    await connection.execute("INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'WITHDRAWAL', 'Withdrawal submitted', ?, 'wallet/withdrawals')", [randomUUID(), identity.userId, `${requestCode} is pending review.`]);
    return { id: requestCode, userId: identity.publicId, payoutMethodId, amount, status: "pending", createdAt: new Date().toISOString() };
  });
}

export async function createPayoutMethod(identity: MobileIdentity, input: { type: "UPI" | "BANK"; displayName: string; destination: string }) {
  const destination = input.destination.trim();
  if (destination.length < 4 || destination.length > 190) throw new Error("Enter a valid payout destination.");
  if (input.type === "UPI" && !/^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9.-]{2,}$/.test(destination)) throw new Error("Enter a valid UPI ID.");
  const lastFour = destination.replace(/\s/g, "").slice(-4);
  const masked = input.type === "UPI"
    ? `${destination.slice(0, 1)}•••${destination.includes("@") ? destination.slice(destination.indexOf("@")) : lastFour}`
    : `•••• ${lastFour}`;
  const protectedValue = encryptPrivateText(destination);
  const id = randomUUID();
  await db().execute(
    `INSERT INTO payout_methods
      (id, application_user_id, method_type, display_name, masked_destination, destination_encrypted, destination_iv, destination_tag)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, identity.userId, input.type, input.displayName, masked, protectedValue.encryptedData, protectedValue.iv, protectedValue.tag],
  );
  return { id, type: input.type === "UPI" ? "upi" : "bankTransfer", displayName: input.displayName, maskedDestination: masked, verified: false };
}

export async function setFollow(identity: MobileIdentity, type: "user" | "agency", publicId: string, followed: boolean) {
  if (type === "user") {
    const [targets] = await db().query<(RowDataPacket & { id: string })[]>("SELECT id FROM application_users WHERE public_id = ? AND account_status = 'ACTIVE' LIMIT 1", [publicId]);
    if (!targets[0] || targets[0].id === identity.userId) throw new Error("The user cannot be followed.");
    if (followed) await db().execute("INSERT IGNORE INTO user_follows (follower_application_user_id, followed_application_user_id) VALUES (?, ?)", [identity.userId, targets[0].id]);
    else await db().execute("DELETE FROM user_follows WHERE follower_application_user_id = ? AND followed_application_user_id = ?", [identity.userId, targets[0].id]);
  } else {
    const [targets] = await db().query<(RowDataPacket & { id: string })[]>("SELECT id FROM platform_accounts WHERE public_id = ? AND role = 'AGENCY' AND status = 'ACTIVE' LIMIT 1", [publicId]);
    if (!targets[0]) throw new Error("The agency cannot be followed.");
    if (followed) await db().execute("INSERT IGNORE INTO agency_follows (application_user_id, agency_account_id) VALUES (?, ?)", [identity.userId, targets[0].id]);
    else await db().execute("DELETE FROM agency_follows WHERE application_user_id = ? AND agency_account_id = ?", [identity.userId, targets[0].id]);
  }
  return { followed };
}

export async function createRoom(identity: MobileIdentity, input: { roomCode: string; kind: string; title: string; category: string; language: string; privacy: "public" | "followers" | "locked"; seatCount: number; themeIndex: number; themeEnabled: boolean; countryCode?: string; photoDataUrl?: string; password?: string }) {
  const roomType = input.kind === "party" ? "PARTY" : input.kind === "face" ? "FACE" : "LIVE";
  const policy = LiveAccessPolicyService.for(identity);
  const access = roomType === "PARTY" ? policy.party : roomType === "FACE" ? policy.face : policy.video;
  if (!access.allowed) throw new Error(access.reason);
  const roomId = randomUUID();
  const photo = input.photoDataUrl
    ? await publicImageFromDataUrl(input.photoDataUrl, 1536 * 1024, "Room photo", { maxWidth: 1440, maxHeight: 1920 })
    : null;
  const photoAssetId = photo ? randomUUID() : null;
  if (input.privacy === "locked" && !/^(\d{4}|\d{6}|\d{10})$/.test(input.password ?? "")) {
    throw new Error("Locked rooms require a 4, 6, or 10 digit password.");
  }
  const passwordHash = input.privacy === "locked" ? await bcrypt.hash(input.password!, 10) : null;
  await withTransaction(async (connection) => {
    const [userRows] = await connection.query<(RowDataPacket & { agency_account_id: string | null; account_status: string })[]>("SELECT agency_account_id, account_status FROM application_users WHERE id = ? LIMIT 1 FOR UPDATE", [identity.userId]);
    if (!userRows[0] || userRows[0].account_status !== "ACTIVE") throw new Error("This account cannot create a room.");
    const [hostRows] = await connection.query<(RowDataPacket & { status: string })[]>("SELECT status FROM host_profiles WHERE application_user_id = ? LIMIT 1 FOR UPDATE", [identity.userId]);
    if (hostRows[0] && ["SUSPENDED", "INACTIVE"].includes(hostRows[0].status)) throw new Error("Hosting is suspended or inactive. Contact your Agency or support to restore access.");
    const [restrictionRows] = await connection.query<RowDataPacket[]>(
      `SELECT id FROM moderation_restrictions
       WHERE application_user_id = ? AND status = 'ACTIVE'
         AND restriction_type IN ('TEMP_LIVE_BAN','SUSPENSION')
         AND (ends_at IS NULL OR ends_at > CURRENT_TIMESTAMP(3))
       LIMIT 1 FOR UPDATE`,
      [identity.userId],
    );
    if (restrictionRows[0]) throw new Error("Live hosting is temporarily restricted. Check your Nazraa notifications or contact support.");
    const [rewardRuleRows] = await connection.query<(RowDataPacket & { id: string })[]>(
      `SELECT id FROM host_reward_rules
       WHERE room_type = ? AND enabled = TRUE AND effective_from <= CURRENT_TIMESTAMP(3)
       ORDER BY effective_from DESC LIMIT 1`,
      [roomType],
    );
    if (!rewardRuleRows[0]) throw new Error("The host reward rule is unavailable.");
    if (photo && photoAssetId) {
      await connection.execute("INSERT INTO room_photo_assets (id, owner_application_user_id, mime_type, image_data, byte_size) VALUES (?, ?, ?, ?, ?)", [photoAssetId, identity.userId, photo.mimeType, photo.data, photo.byteSize]);
    }
    await connection.execute(
      "INSERT INTO live_rooms (id, room_code, host_application_user_id, agency_account_id, room_type, title, category, language_code, privacy, password_hash, password_length, seat_count, theme_index, theme_enabled, room_photo_asset_id, country_code, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [roomId, input.roomCode, identity.userId, userRows[0]?.agency_account_id ?? null, roomType, input.title, input.category, input.language, input.privacy.toUpperCase(), passwordHash, input.password?.length ?? null, roomType === "PARTY" ? input.seatCount : 0, input.themeIndex, input.themeEnabled, photoAssetId, input.countryCode ?? null, "ACTIVE"],
    );
    await connection.execute(
      "INSERT INTO live_session_accounting (id, room_id, host_application_user_id, room_type, started_at, reward_rule_id) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3), ?)",
      [randomUUID(), roomId, identity.userId, roomType, rewardRuleRows[0].id],
    );
    await connection.execute(
      "INSERT INTO live_room_members (room_id, application_user_id, room_role, muted) VALUES (?, ?, 'OWNER', FALSE)",
      [roomId, identity.userId],
    );
  });
  return { id: roomId, roomCode: input.roomCode, status: "ACTIVE" };
}

export async function sendGift(identity: MobileIdentity, input: { clientGiftId?: string; roomCode: string; giftId: string; recipientPublicId: string; quantity: number }) {
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 99) throw new Error("Choose a valid gift quantity.");
  const idempotencyKey = `GIFT:${identity.userId}:${input.clientGiftId ?? randomUUID()}`;
  return withTransaction(async (connection) => {
    const [previousRows] = await connection.query<(RowDataPacket & { amount: number; metadata: unknown })[]>(
      "SELECT amount, metadata FROM ledger_transactions WHERE idempotency_key = ? LIMIT 1 FOR UPDATE",
      [idempotencyKey],
    );
    const previous = previousRows[0];
    if (previous) {
      const metadata = asObject(previous.metadata);
      if (String(metadata.roomCode ?? "") !== input.roomCode || String(metadata.giftId ?? "") !== input.giftId || String(metadata.recipientPublicId ?? "") !== input.recipientPublicId || Number(metadata.quantity ?? 0) !== input.quantity) {
        throw new Error("This gift request ID was already used.");
      }
      const [balanceRows] = await connection.query<(RowDataPacket & { available_balance: number })[]>(
        "SELECT available_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' LIMIT 1",
        [identity.userId],
      );
      return { success: true, remainingCoins: Number(balanceRows[0]?.available_balance ?? 0), message: "Gift already sent", rocket: null, event: null };
    }
    const [giftRows] = await connection.query<(RowDataPacket & { id: string; name: string; emoji: string | null; visual_url: string | null; coin_price: number })[]>("SELECT id, name, emoji, visual_url, coin_price FROM gift_catalog WHERE gift_key = ? AND active = TRUE LIMIT 1", [input.giftId]);
    const [roomRows] = await connection.query<(RowDataPacket & { id: string })[]>(
      `SELECT room.id FROM live_rooms room
       INNER JOIN live_room_members sender ON sender.room_id = room.id AND sender.application_user_id = ? AND sender.left_at IS NULL
       WHERE room.room_code = ? AND room.status IN ('ACTIVE','LOCKED') LIMIT 1 FOR UPDATE`,
      [identity.userId, input.roomCode],
    );
    const room = roomRows[0];
    if (!room) throw new Error("Join this room before sending a gift.");
    const [recipientRows] = await connection.query<(RowDataPacket & { id: string; public_id: string; full_name: string; avatar_url: string | null; avatar_updated_at: Date | null; country_code: string | null; language_code: string | null; vip_tier: number; consumption_points: number; anchor_income_points: number })[]>(
      `SELECT user.id, user.public_id, user.full_name, user.avatar_url, avatar.updated_at avatar_updated_at,
              user.country_code, user.language_code, user.vip_tier, user.consumption_points, user.anchor_income_points
       FROM live_room_members member INNER JOIN application_users user ON user.id = member.application_user_id
       LEFT JOIN application_user_avatars avatar ON avatar.application_user_id = user.id
       WHERE member.room_id = ? AND member.left_at IS NULL
         AND member.last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 2 MINUTE
         AND user.public_id = ? AND user.account_status = 'ACTIVE' LIMIT 1 FOR UPDATE`,
      [room.id, input.recipientPublicId],
    );
    const [senderProfileRows] = await connection.query<(RowDataPacket & { public_id: string; full_name: string; avatar_url: string | null; avatar_updated_at: Date | null; country_code: string | null; language_code: string | null; vip_tier: number; consumption_points: number; anchor_income_points: number })[]>(
      `SELECT user.public_id, user.full_name, user.avatar_url, avatar.updated_at avatar_updated_at,
              user.country_code, user.language_code, user.vip_tier, user.consumption_points, user.anchor_income_points
       FROM application_users user LEFT JOIN application_user_avatars avatar ON avatar.application_user_id = user.id
       WHERE user.id = ? LIMIT 1`,
      [identity.userId],
    );
    const gift = giftRows[0]; const recipient = recipientRows[0]; const sender = senderProfileRows[0];
    if (!gift || !recipient || !sender) throw new Error("The gift or active room recipient is unavailable.");
    const total = Number(gift.coin_price) * input.quantity;
    await ensureWallet(connection, identity.userId, "COIN"); await ensureWallet(connection, recipient.id, "DIAMOND");
    const [senderRows] = await connection.query<(RowDataPacket & { id: string; available_balance: number })[]>("SELECT id, available_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' FOR UPDATE", [identity.userId]);
    const [receiverRows] = await connection.query<(RowDataPacket & { id: string; available_balance: number })[]>("SELECT id, available_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'DIAMOND' FOR UPDATE", [recipient.id]);
    if (Number(senderRows[0].available_balance) < total) throw new Error("Not enough social coins.");
    await connection.execute("UPDATE wallet_balances SET available_balance = available_balance - ? WHERE id = ?", [total, senderRows[0].id]);
    await connection.execute("UPDATE wallet_balances SET available_balance = available_balance + ? WHERE id = ?", [total, receiverRows[0].id]);
    const transferCode = code("GFT");
    await connection.execute(
      `INSERT INTO ledger_transactions (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, source_id, destination_type, destination_id, amount, status, reason, metadata)
       VALUES (?, ?, ?, 'COIN', 'GIFT_SPEND', 'APPLICATION_USER', ?, 'APPLICATION_USER', ?, ?, 'COMPLETED', ?, JSON_OBJECT('roomCode', ?, 'giftId', ?, 'recipientPublicId', ?, 'quantity', ?))`,
      [randomUUID(), `${transferCode}-S`, idempotencyKey, identity.userId, recipient.id, total, `${gift.name} ×${input.quantity}`, input.roomCode, input.giftId, input.recipientPublicId, input.quantity],
    );
    await connection.execute(
      `INSERT INTO ledger_transactions (id, transaction_code, asset_type, transaction_type, source_type, source_id, destination_type, destination_id, amount, status, reason)
       VALUES (?, ?, 'DIAMOND', 'GIFT_RECEIVE', 'APPLICATION_USER', ?, 'APPLICATION_USER', ?, ?, 'COMPLETED', ?)`,
      [randomUUID(), `${transferCode}-R`, identity.userId, recipient.id, total, `${gift.name} ×${input.quantity}`],
    );
    await connection.execute(
      `UPDATE application_users
       SET level_number = LEAST(120, FLOOR(SQRT(GREATEST(0, consumption_points + ?) / 500)) + 1),
           consumption_points = consumption_points + ?
       WHERE id = ?`,
      [total, total, identity.userId],
    );
    await connection.execute("UPDATE application_users SET anchor_income_points = anchor_income_points + ? WHERE id = ?", [total, recipient.id]);
    await connection.execute("UPDATE live_room_members SET last_seen_at = CURRENT_TIMESTAMP(3) WHERE room_id = ? AND application_user_id = ?", [room.id, identity.userId]);
    const eventId = randomUUID();
    await connection.execute(
      `INSERT INTO live_room_gift_events
       (id, room_id, sender_application_user_id, receiver_application_user_id, gift_catalog_id, quantity, coin_value)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [eventId, room.id, identity.userId, recipient.id, gift.id, input.quantity, total],
    );
    const rocket = await recordRocketGift(connection, {
      roomId: room.id,
      giftEventId: eventId,
      senderUserId: identity.userId,
      coinValue: total,
    });
    const [postRocketWalletRows] = await connection.query<(RowDataPacket & { available_balance: number })[]>(
      "SELECT available_balance FROM wallet_balances WHERE id = ? LIMIT 1",
      [senderRows[0].id],
    );
    return {
      success: true,
      remainingCoins: Number(postRocketWalletRows[0]?.available_balance ?? Number(senderRows[0].available_balance) - total),
      message: `Sent to ${recipient.full_name}`,
      rocket,
      event: {
        id: eventId, quantity: input.quantity, value: total, createdAt: new Date().toISOString(),
        gift: { id: input.giftId, name: gift.name, symbol: gift.emoji ?? giftSymbol(input.giftId, gift.name), imageUrl: gift.visual_url },
        sender: { id: String(sender.public_id), name: sender.full_name, avatarUrl: mobileAvatarUrl(sender), country: sender.country_code ?? "", language: sender.language_code ?? "", level: levelProgress(Number(sender.consumption_points) + total, "consumption").level, anchorLevel: levelProgress(Number(sender.anchor_income_points), "anchorIncome").level, vip: Number(sender.vip_tier) },
        receiver: { id: String(recipient.public_id), name: recipient.full_name, avatarUrl: mobileAvatarUrl(recipient), country: recipient.country_code ?? "", language: recipient.language_code ?? "", level: levelProgress(Number(recipient.consumption_points), "consumption").level, anchorLevel: levelProgress(Number(recipient.anchor_income_points) + total, "anchorIncome").level, vip: Number(recipient.vip_tier) },
      },
    };
  });
}

export async function mutateGameWallet(identity: MobileIdentity, input: {
  clientTransactionId: string; direction: "DEBIT" | "CREDIT"; amount: number; game: string; reason: string;
}) {
  if (!Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > 10_000_000) throw new Error("Choose a valid game amount.");
  return withTransaction(async (connection) => {
    const [existingRows] = await connection.query<(RowDataPacket & { direction: string; amount: number; balance_after: number })[]>(
      "SELECT direction, amount, balance_after FROM game_wallet_events WHERE client_transaction_id = ? AND application_user_id = ? LIMIT 1 FOR UPDATE",
      [input.clientTransactionId, identity.userId],
    );
    const existing = existingRows[0];
    if (existing) {
      if (existing.direction !== input.direction || Number(existing.amount) !== input.amount) throw new Error("This game transaction ID was already used.");
      return { success: true, coinBalance: Number(existing.balance_after), message: "Already recorded" };
    }
    await ensureWallet(connection, identity.userId, "COIN");
    const [walletRows] = await connection.query<(RowDataPacket & { id: string; available_balance: number })[]>(
      "SELECT id, available_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' LIMIT 1 FOR UPDATE",
      [identity.userId],
    );
    const before = Number(walletRows[0].available_balance);
    if (input.direction === "DEBIT" && before < input.amount) throw new Error("Not enough coins.");
    const after = input.direction === "DEBIT" ? before - input.amount : before + input.amount;
    await connection.execute("UPDATE wallet_balances SET available_balance = ? WHERE id = ?", [after, walletRows[0].id]);
    const ledgerId = randomUUID();
    const transactionCode = code(input.direction === "DEBIT" ? "GMD" : "GMC");
    await connection.execute(
      `INSERT INTO ledger_transactions
       (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, source_id, destination_type, destination_id, amount, status, reason, metadata)
       VALUES (?, ?, ?, 'COIN', ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, JSON_OBJECT('game', ?))`,
      [ledgerId, transactionCode, `GAME:${input.clientTransactionId}`, `GAME_${input.direction}`, input.direction === "DEBIT" ? "APPLICATION_USER" : "GAME", input.direction === "DEBIT" ? identity.userId : null, input.direction === "DEBIT" ? "GAME" : "APPLICATION_USER", input.direction === "DEBIT" ? null : identity.userId, input.amount, input.reason, input.game],
    );
    await connection.execute(
      `INSERT INTO game_wallet_events
       (id, client_transaction_id, application_user_id, direction, amount, game_name, reason, balance_after, ledger_transaction_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), input.clientTransactionId, identity.userId, input.direction, input.amount, input.game, input.reason, after, ledgerId],
    );
    return { success: true, coinBalance: after, message: input.direction === "DEBIT" ? "Accepted" : "Paid" };
  });
}

const teenPattiGame = "teen_patti_pro";
// Reference table odds in tenths: left 2.7x, middle 2.9x, right 2.8x.
// Integer arithmetic keeps wallet settlement exact for every supported chip.
export const teenPattiLaneMultiplierTenths = [27, 29, 28] as const;
export function teenPattiLanePayout(lane: number, bet: number) {
  const multiplier = teenPattiLaneMultiplierTenths[lane];
  if (multiplier == null || !Number.isSafeInteger(bet) || bet < 0) throw new Error("Invalid Teen Patti lane payout.");
  return Math.floor(bet * multiplier / 10);
}
const goldenZoneGames = new Set(["greedy_king", "greedy_lion"]);
const supportedRoundGames = new Set([
  teenPattiGame,
  "luck77",
  "bounty_football",
  "jungle_hunt",
  ...goldenZoneGames,
]);
export const footballMultipliers = [2, 5, 8, 18, 66, 50, 100, 88, 30, 20] as const;
// 0.98 / displayed multiplier, scaled to integers. The five-unit rounding
// difference is normalized by chooseWeighted and stays far below one draw in
// a million. This is the reference game's embedded 2% service-margin model.
export const footballWeights = [490000, 196000, 122500, 54444, 14848, 19600, 9800, 11136, 32667, 49000] as const;
const junglePaylines = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 2, 1, 0, 1],
  [1, 0, 1, 2, 1], [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [2, 1, 1, 1, 0], [0, 1, 1, 1, 2],
] as const;
export const jungleSymbols = ["wild", "lion", "elephant", "rhino", "crocodile", "gorilla", "a", "k", "q", "j", "ten", "jackpot"] as const;
type JungleSymbol = typeof jungleSymbols[number];
const junglePaytable: Record<Exclude<JungleSymbol, "wild" | "jackpot">, Readonly<Record<3 | 4 | 5, number>>> = {
  lion: { 3: 100, 4: 500, 5: 1500 },
  elephant: { 3: 50, 4: 300, 5: 1000 },
  rhino: { 3: 40, 4: 150, 5: 800 },
  crocodile: { 3: 35, 4: 100, 5: 600 },
  gorilla: { 3: 30, 4: 80, 5: 500 },
  a: { 3: 15, 4: 50, 5: 150 },
  k: { 3: 15, 4: 50, 5: 150 },
  q: { 3: 10, 4: 20, 5: 80 },
  j: { 3: 5, 4: 15, 5: 60 },
  ten: { 3: 5, 4: 10, 5: 50 },
};
// The supplied material does not establish reel weights for the additional
// symbols. Preserve the four existing production reel symbols until the
// Master config supplies verified weights; the evaluator below already
// supports the complete paytable, Wild and confirmed Jackpot patterns.
const jungleConfiguredReelSymbols: readonly JungleSymbol[] = ["ten", "crocodile", "rhino", "elephant"];

type ServerGameRoundInput = {
  clientRoundId: string;
  game: string;
  bets: Record<string, number>;
};

type ServerGameOutcome = {
  outcome: Record<string, unknown>;
  wager: number;
  payout: number;
  commissionablePayout?: number;
};

type GameEconomyRules = {
  targetWinRate: number;
  winningsDeductionRate: number;
};

const defaultGameEconomyRules: GameEconomyRules = {
  targetWinRate: 0.6,
  winningsDeductionRate: 0.01,
};

function gameEconomyRules(value: unknown): GameEconomyRules {
  const setting = mobileGamesConfig(value);
  const target = Number(setting.target_win_rate ?? defaultGameEconomyRules.targetWinRate);
  const deduction = Number(setting.winnings_deduction_rate ?? defaultGameEconomyRules.winningsDeductionRate);
  return {
    targetWinRate: Number.isFinite(target) ? Math.max(0, Math.min(1, target)) : defaultGameEconomyRules.targetWinRate,
    winningsDeductionRate: Number.isFinite(deduction) ? Math.max(0, Math.min(0.25, deduction)) : defaultGameEconomyRules.winningsDeductionRate,
  };
}

async function gameSettings(connection: PoolConnection) {
  const [rows] = await connection.query<(RowDataPacket & { setting_value: unknown })[]>(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.games' LIMIT 1",
  );
  return mobileGamesConfig(rows[0]?.setting_value);
}

function targetPlayerWin(rate: number) {
  return randomInt(1_000_000) < Math.round(rate * 1_000_000);
}

function chooseIndexForTarget(
  values: readonly number[],
  grossPayout: (index: number) => number,
  wager: number,
  targetWin: boolean,
) {
  const preferred = values.filter((index) => targetWin ? grossPayout(index) > wager : grossPayout(index) <= wager);
  const candidates = preferred.length ? preferred : values;
  return candidates[randomInt(candidates.length)];
}

function canonicalBets(bets: Record<string, number>) {
  return Object.fromEntries(Object.entries(bets).sort(([left], [right]) => left.localeCompare(right)));
}

function checkedBets(bets: Record<string, number>, keys: readonly string[], unit: number, maximum = 50_000_000) {
  const allowed = new Set(keys);
  if (Object.keys(bets).some((key) => !allowed.has(key))) throw new Error("This game bet contains an invalid option.");
  const result: Record<string, number> = {};
  let total = 0;
  for (const key of keys) {
    const amount = bets[key] ?? 0;
    if (!Number.isSafeInteger(amount) || amount < 0 || amount % unit !== 0) throw new Error("Choose a valid game amount.");
    result[key] = amount;
    total += amount;
  }
  if (!Number.isSafeInteger(total) || total > maximum) throw new Error("The total game amount is too large.");
  return { bets: result, total };
}

function secureShuffle<T>(items: T[]) {
  for (let index = items.length - 1; index > 0; index--) {
    const selected = randomInt(index + 1);
    [items[index], items[selected]] = [items[selected], items[index]];
  }
  return items;
}

function teenPattiValue(cards: number[]) {
  const ranks = cards.map((card) => card % 13 + 2).sort((a, b) => b - a);
  const suits = cards.map((card) => Math.floor(card / 13));
  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const flush = new Set(suits).size === 1;
  const unique = new Set(ranks).size === 3;
  const sequence = unique && (
    (ranks[0] === 14 && ranks[1] === 13 && ranks[2] === 12) ||
    (ranks[0] === 14 && ranks[1] === 3 && ranks[2] === 2) ||
    (ranks[0] - 1 === ranks[1] && ranks[1] - 1 === ranks[2])
  );
  const sequenceRank = ranks[0] === 14 && ranks[1] === 13 && ranks[2] === 12
    ? 15
    : ranks[0] === 14 && ranks[1] === 3 && ranks[2] === 2
      ? 14
      : ranks[0];
  if (counts.size === 1) return { category: "trail", label: "Three of a Kind", multiplier: 25, categoryRank: 5, tieBreak: [ranks[0]] };
  if (flush && sequence) return { category: "pureSequence", label: "Straight Flush", multiplier: 10, categoryRank: 4, tieBreak: [sequenceRank] };
  if (sequence) return { category: "sequence", label: "Straight", multiplier: 2, categoryRank: 3, tieBreak: [sequenceRank] };
  if (flush) return { category: "color", label: "Flush", multiplier: 4, categoryRank: 2, tieBreak: ranks };
  const pairRank = [...counts.entries()].find(([, count]) => count === 2)?.[0];
  if (pairRank != null) {
    const kicker = [...counts.entries()].find(([, count]) => count === 1)?.[0] ?? 0;
    return { category: "pair", label: "Pair", multiplier: 0, categoryRank: 1, tieBreak: [pairRank, kicker] };
  }
  return { category: "highCard", label: "High Card", multiplier: 0, categoryRank: 0, tieBreak: ranks };
}

function compareTeenPattiHands(left: ReturnType<typeof teenPattiValue>, right: ReturnType<typeof teenPattiValue>) {
  if (left.categoryRank !== right.categoryRank) return left.categoryRank - right.categoryRank;
  for (let index = 0; index < Math.max(left.tieBreak.length, right.tieBreak.length); index++) {
    const compared = (left.tieBreak[index] ?? 0) - (right.tieBreak[index] ?? 0);
    if (compared !== 0) return compared;
  }
  return 0;
}

function strongestTeenPattiLane(hands: ReturnType<typeof buildTeenPattiHands>) {
  let winner = 0;
  for (let lane = 1; lane < hands.length; lane++) {
    if (compareTeenPattiHands(hands[lane], hands[winner]) > 0) winner = lane;
  }
  return winner;
}

function teenPattiRound(input: Record<string, number>, targetWin: boolean): ServerGameOutcome {
  const checked = checkedBets(input, ["0", "1", "2", "crown"], 500);
  if (["0", "1", "2"].filter((key) => checked.bets[key] > 0).length > 2) {
    throw new Error("You can bet on up to 2 hands.");
  }
  if (checked.total === 0) {
    const hands = buildTeenPattiHands();
    const winnerLane = strongestTeenPattiLane(hands);
    const winner = hands[winnerLane];
    return {
      outcome: {
        hands,
        winnerLane,
        winningCategory: winner.category,
        winningLabel: winner.label,
        crownMultiplier: winner.multiplier,
        normalMultipliers: teenPattiLaneMultiplierTenths.map((value) => value / 10),
        normalMultiplier: teenPattiLaneMultiplierTenths[winnerLane] / 10,
        payoutMultiplier: teenPattiLaneMultiplierTenths[winnerLane] / 10,
        normalPayout: 0,
        crownPayout: 0,
        spectator: true,
        targetWin: false,
      },
      wager: 0,
      payout: 0,
    };
  }
  let selectedHands: ReturnType<typeof buildTeenPattiHands> | null = null;
  let selectedPayout = 0;
  let selectedWinner = 0;
  for (let attempt = 0; attempt < 512; attempt++) {
    const hands = buildTeenPattiHands();
    const winnerLane = strongestTeenPattiLane(hands);
    const crownMultiplier = hands[winnerLane].multiplier;
    const payout = teenPattiLanePayout(winnerLane, checked.bets[String(winnerLane)]) + checked.bets.crown * crownMultiplier;
    selectedHands = hands;
    selectedPayout = payout;
    selectedWinner = winnerLane;
    if (targetWin ? payout > checked.total : payout <= checked.total) break;
  }
  const winner = selectedHands![selectedWinner];
  const normalPayout = teenPattiLanePayout(selectedWinner, checked.bets[String(selectedWinner)]);
  const crownPayout = checked.bets.crown * winner.multiplier;
  return {
    outcome: {
      hands: selectedHands,
      winnerLane: selectedWinner,
      winningCategory: winner.category,
      winningLabel: winner.label,
      crownMultiplier: winner.multiplier,
      normalMultipliers: teenPattiLaneMultiplierTenths.map((value) => value / 10),
      normalMultiplier: teenPattiLaneMultiplierTenths[selectedWinner] / 10,
      payoutMultiplier: teenPattiLaneMultiplierTenths[selectedWinner] / 10,
      normalPayout,
      crownPayout,
      crownWon: crownPayout > 0,
      targetWin,
    },
    wager: checked.total,
    payout: selectedPayout,
    // The supplied rules charge commission only on the normal-hand return;
    // Crown payout is deliberately outside this base.
    commissionablePayout: normalPayout,
  };
}

function buildTeenPattiHands() {
  const deck = secureShuffle(Array.from({ length: 52 }, (_, index) => index));
  return [deck.slice(0, 3), deck.slice(3, 6), deck.slice(6, 9)].map((cards) => ({
    cards: cards.map((card) => ({ rank: card % 13 + 2, suit: Math.floor(card / 13) })),
    ...teenPattiValue(cards),
  }));
}

function luck77Round(input: Record<string, number>, _targetWin: boolean): ServerGameOutcome {
  void _targetWin;
  const keys = ["watermelon", "seven", "plum"] as const;
  const checked = checkedBets(input, keys, 100);
  if (checked.total === 0) throw new Error("Choose a Luck77 house.");
  // Nine equal visual sectors: four Watermelon, four Plum, one Lucky 77.
  // The draw is global/configuration-driven and never depends on one user's bet.
  const segments = ["seven", "watermelon", "plum", "watermelon", "plum", "watermelon", "plum", "watermelon", "plum"] as const;
  const winner = randomInt(segments.length);
  const winningHouse = segments[winner];
  const multiplier = winningHouse === "seven" ? 8 : 2;
  return { outcome: { winner: winningHouse, winningSegment: winner, multiplier, lucky77SpecialBonusEnabled: false }, wager: checked.total, payout: checked.bets[winningHouse] * multiplier };
}

function footballRound(input: Record<string, number>, _targetWin: boolean): ServerGameOutcome {
  void _targetWin;
  const checked = checkedBets(input, footballMultipliers.map((_, index) => String(index)), 500);
  if (checked.total === 0) throw new Error("Choose a Bounty Football zone.");
  const winner = chooseWeighted(footballWeights.map((weight, index) => ({ index, weight }))).index;
  const multiplier = footballMultipliers[winner];
  return {
    outcome: {
      winner, multiplier, probabilityWeight: footballWeights[winner],
      feeModel: "EMBEDDED_IN_ODDS", serviceMarginPercent: 2,
    },
    wager: checked.total,
    payout: checked.bets[String(winner)] * multiplier,
    commissionablePayout: 0,
  };
}

function jungleMultiplier(symbol: JungleSymbol, matches: number) {
  if (symbol === "wild" || symbol === "jackpot" || (matches !== 3 && matches !== 4 && matches !== 5)) return 0;
  return junglePaytable[symbol][matches];
}

function jungleRound(input: Record<string, number>, _targetWin: boolean, config?: GameRuntimeConfig): ServerGameOutcome {
  void _targetWin;
  const denominations = config?.denominations ?? [150, 300, 750, 1500, 3000];
  const unit = denominations.reduce(greatestCommonDivisor);
  const checked = checkedBets(input, ["spin"], unit, config?.maximumBet ?? 3_000);
  if (checked.total === 0) throw new Error("Choose a spin amount.");
  if (checked.total < (config?.minimumBet ?? 150)) throw new Error(`The minimum spin is ${config?.minimumBet ?? 150} coins.`);
  if (checked.total % junglePaylines.length !== 0) throw new Error("The Jungle Hunt bet must cover all 15 lines.");
  const grid = Array.from({ length: 3 }, () => Array.from({ length: 5 }, () => jungleConfiguredReelSymbols[randomInt(jungleConfiguredReelSymbols.length)]));
  const result = evaluateJungleGrid(grid, checked.total);
  return {
    outcome: {
      grid: result.grid, winningLines: result.winningLines,
      lineWins: result.lineWins, jackpotResult: result.jackpotResult,
      payoutBasis: "LINE_BET", paylines: 15,
    },
    wager: checked.total,
    payout: result.payout,
  };
}

export function evaluateJungleGrid(grid: JungleSymbol[][], total: number) {
  const winningLines: number[] = [];
  const lineWins: { line: number; symbol: JungleSymbol; matches: number; payout: number }[] = [];
  const lineBet = total / junglePaylines.length;
  let payout = 0;
  for (let line = 0; line < junglePaylines.length; line++) {
    const path = junglePaylines[line];
    const symbols = path.map((row, column) => grid[row][column]);
    const firstNormal = symbols.find((symbol) => symbol !== "wild");
    if (!firstNormal || firstNormal === "jackpot") continue;
    let matches = 0;
    for (const symbol of symbols) {
      if (symbol !== firstNormal && symbol !== "wild") break;
      matches++;
    }
    if (matches < 3) continue;
    const linePayout = lineBet * jungleMultiplier(firstNormal, matches);
    if (linePayout <= 0) continue;
    winningLines.push(line + 1);
    payout += linePayout;
    lineWins.push({ line: line + 1, symbol: firstNormal, matches, payout: linePayout });
  }
  const jackpotResult = grid[1].every((symbol) => symbol === "jackpot")
    ? { pattern: 1, payout: 1_000_000 }
    : grid[0].every((symbol) => symbol === "jackpot")
      ? { pattern: 2, payout: 500_000 }
      : grid[2].every((symbol) => symbol === "jackpot")
        ? { pattern: 3, payout: 500_000 }
        : null;
  if (jackpotResult) payout += jackpotResult.payout;
  return { grid, winningLines, lineWins, jackpotResult, payout };
}

function chooseWeighted<T extends { weight: number }>(values: readonly T[]) {
  const total = values.reduce((sum, value) => sum + value.weight, 0);
  const ticket = randomInt(total);
  let cursor = 0;
  for (const value of values) {
    cursor += value.weight;
    if (ticket < cursor) return value;
  }
  return values[values.length - 1];
}

function threeCardValue(cards: number[]) {
  const ranks = cards.map((card) => card % 13 + 2).sort((a, b) => a - b);
  const suits = cards.map((card) => Math.floor(card / 13));
  const flush = new Set(suits).size === 1;
  const straight = (ranks[2] - ranks[0] === 2 && ranks[1] - ranks[0] === 1) ||
    (ranks[0] === 2 && ranks[1] === 3 && ranks[2] === 14);
  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  if (counts.size === 1) return { class: 6, score: 100_000 + ranks[0], label: "Three of a Kind" };
  if (straight && flush) return { class: 5, score: 80_000 + ranks[2], label: "Straight Flush" };
  if (straight) return { class: 4, score: 60_000 + ranks[2], label: "Straight" };
  if (flush) return { class: 3, score: 40_000 + ranks[2] * 169 + ranks[1] * 13 + ranks[0], label: "Flush" };
  const pair = [...counts.entries()].find(([, count]) => count === 2);
  if (pair) {
    const kicker = [...counts.entries()].find(([, count]) => count === 1)?.[0] ?? 0;
    return { class: 2, score: 20_000 + pair[0] * 20 + kicker, label: "Pair" };
  }
  return { class: 1, score: ranks[2] * 169 + ranks[1] * 13 + ranks[0], label: "High Card" };
}

function threeCardRound(input: Record<string, number>, targetWin: boolean): ServerGameOutcome {
  const checked = checkedBets(input, ["0", "1", "2"], 100, 500_000);
  if (checked.total === 0) throw new Error("Choose a Three Card seat.");
  if (Object.values(checked.bets).filter((amount) => amount > 0).length > 2) {
    throw new Error("Choose no more than two Three Card seats.");
  }
  const deck = secureShuffle(Array.from({ length: 52 }, (_, index) => index));
  const hands = [deck.slice(0, 3), deck.slice(3, 6), deck.slice(6, 9)].map((cards) => ({
    cards,
    ...threeCardValue(cards),
  }));
  let naturalWinner = 0;
  for (let index = 1; index < hands.length; index++) {
    if (hands[index].class > hands[naturalWinner].class ||
        (hands[index].class === hands[naturalWinner].class && hands[index].score > hands[naturalWinner].score)) naturalWinner = index;
  }
  const winner = chooseIndexForTarget([0, 1, 2], (index) => checked.bets[String(index)] * 3, checked.total, targetWin);
  if (winner !== naturalWinner) [hands[winner], hands[naturalWinner]] = [hands[naturalWinner], hands[winner]];
  return {
    outcome: { hands, winningSeat: winner + 1, multiplier: 3, label: `Seat ${winner + 1}`, targetWin },
    wager: checked.total,
    payout: checked.bets[String(winner)] * 3,
  };
}

export function evaluateGreedyRound(
  game: "greedy_lion" | "greedy_king",
  input: Record<string, number>,
  outcome: number | "salad" | "pizza",
): ServerGameOutcome {
  const lion = game === "greedy_lion";
  const keys = Array.from({ length: lion ? 8 : 10 }, (_, index) => String(index));
  const checked = checkedBets(input, keys, 500, 50_000_000);
  if (checked.total === 0) throw new Error(lion ? "Choose at least one food house." : "Choose at least one wheel zone.");
  const multipliers = lion
    ? [5, 45, 25, 5, 15, 5, 5, 10] as const
    : [5, 10, 15, 25, 45, 5, 5, 5, 1.25, 4.37] as const;
  const labels = lion
    ? ["Strawberry", "Chicken", "Octopus", "Corn", "Fish", "Lettuce", "Grapes", "Steak"] as const
    : ["Carrot", "Hot Dog", "Skewers", "Ham", "Steak", "Tomato", "Corn", "Lettuce", "Salad", "Pizza"] as const;
  const saladMembers = lion ? [0, 3, 5, 6] : [0, 5, 6, 7];
  const pizzaMembers = lion ? [1, 2, 4, 7] : [1, 2, 3, 4];
  if (outcome === "salad" || outcome === "pizza") {
    const winners = outcome === "salad" ? saladMembers : pizzaMembers;
    const payout = Math.floor(winners.reduce((sum, index) => sum + checked.bets[String(index)] * multipliers[index], 0));
    return {
      outcome: {
        winner: outcome, label: outcome === "salad" ? "Salad" : "Pizza",
        winners, winningGroups: [outcome.toUpperCase()], specialResult: true,
      },
      wager: checked.total,
      payout,
    };
  }
  const winner = outcome;
  if (!Number.isSafeInteger(winner) || winner < 0 || winner >= 8) throw new Error("The Greedy result is invalid.");
  const categoryFor = (index: number) => saladMembers.includes(index) ? 8 : 9;
  const multiplier = multipliers[winner];
  const secondaryWinner = lion ? null : categoryFor(winner);
  const payout = Math.floor(
    checked.bets[String(winner)] * multiplier +
    (secondaryWinner == null ? 0 : checked.bets[String(secondaryWinner)] * Number(multipliers[secondaryWinner] ?? 0)),
  );
  return {
    outcome: {
      winner, winningZone: winner + 1, multiplier, label: labels[winner],
      winningGroups: [saladMembers.includes(winner) ? "SALAD" : "PIZZA"], specialResult: false,
      secondaryWinner,
      secondaryLabel: secondaryWinner == null ? null : labels[secondaryWinner],
      secondaryMultiplier: secondaryWinner == null ? null : multipliers[secondaryWinner],
      winners: secondaryWinner == null ? [winner] : [winner, secondaryWinner],
    },
    wager: checked.total,
    payout,
  };
}

function greedyRound(game: string, input: Record<string, number>, _targetWin: boolean): ServerGameOutcome {
  void _targetWin;
  // Exact Greedy draw weights and pool triggers are not established by the
  // supplied evidence. Preserve the existing eight-way normal draw and keep
  // SALAD/PIZZA settlement available for verified configured triggers, rather
  // than inventing a probability or choosing a cheap result from user bets.
  return evaluateGreedyRound(game as "greedy_lion" | "greedy_king", input, randomInt(8));
}

function createServerGameOutcome(game: string, bets: Record<string, number>, targetWin: boolean, config?: GameRuntimeConfig) {
  if (game === teenPattiGame) return teenPattiRound(bets, targetWin);
  if (game === "luck77") return luck77Round(bets, targetWin);
  if (game === "bounty_football") return footballRound(bets, targetWin);
  if (game === "jungle_hunt") return jungleRound(bets, targetWin, config);
  if (game === "three_card") return threeCardRound(bets, targetWin);
  if (goldenZoneGames.has(game)) return greedyRound(game, bets, targetWin);
  throw new Error("This game is unavailable.");
}

const sharedRoundGames = new Set(["luck77", "greedy_lion", "greedy_king", "bounty_football"]);
type SharedRoundGame = "luck77" | "greedy_lion" | "greedy_king" | "bounty_football";
type SharedRoundRow = RowDataPacket & {
  id: string; game_name: SharedRoundGame; round_number: number;
  betting_starts_at: Date; betting_ends_at: Date; drawing_ends_at: Date; result_ends_at: Date;
  outcome_json: unknown;
};

function sharedGame(value: string): SharedRoundGame {
  if (!sharedRoundGames.has(value)) throw new Error("This game does not use shared rounds.");
  return value as SharedRoundGame;
}

async function sharedRoundOutcome(connection: PoolConnection, game: SharedRoundGame, config: GameRuntimeConfig) {
  if (game === "luck77") {
    const segments = ["seven", "watermelon", "plum", "watermelon", "plum", "watermelon", "plum", "watermelon", "plum"] as const;
    const choices = ["seven", "watermelon", "plum"] as const;
    const weights = config.outcomeWeights?.length === 3 ? config.outcomeWeights : [1, 4, 4];
    const winner = chooseWeighted(choices.map((value, index) => ({ value, weight: weights[index] }))).value;
    const possibleSegments = segments
      .map((value, index) => ({ value, index }))
      .filter((item) => item.value === winner);
    const winningSegment = possibleSegments[randomInt(possibleSegments.length)].index;
    return { winner, winningSegment, multiplier: winner === "seven" ? 8 : 2, lucky77SpecialBonusEnabled: false };
  }
  if (game === "bounty_football") {
    const weights = config.outcomeWeights?.length === 10 ? config.outcomeWeights : [...footballWeights];
    const winner = chooseWeighted(weights.map((weight, index) => ({ index, weight }))).index;
    return {
      winner, multiplier: footballMultipliers[winner], probabilityWeight: weights[winner],
      feeModel: "EMBEDDED_IN_ODDS", serviceMarginPercent: 2,
    };
  }
  const [poolRows] = await connection.query<(RowDataPacket & { amount: number })[]>(
    "SELECT amount FROM game_progressive_pools WHERE game_name = ? LIMIT 1 FOR UPDATE",
    [game],
  );
  const poolAmount = Number(poolRows[0]?.amount ?? 0);
  const specialsEligible = poolAmount >= Number(config.poolMinimumForSpecial ?? 0);
  const outcomes: { result: number | "salad" | "pizza"; weight: number }[] = Array.from(
    { length: 8 },
    (_, index) => ({ result: index, weight: 1 }),
  );
  if (specialsEligible && Number(config.saladWeight ?? 0) > 0) {
    outcomes.push({ result: "salad", weight: Number(config.saladWeight) });
  }
  if (specialsEligible && Number(config.pizzaWeight ?? 0) > 0) {
    outcomes.push({ result: "pizza", weight: Number(config.pizzaWeight) });
  }
  const selected = chooseWeighted(outcomes).result;
  const lion = game === "greedy_lion";
  const labels = lion
    ? ["Strawberry", "Chicken", "Octopus", "Corn", "Fish", "Lettuce", "Grapes", "Meat"]
    : ["Carrot", "Hot Dog", "Skewers", "Ham", "Steak", "Tomato", "Corn", "Lettuce"];
  const multipliers = lion ? [5, 45, 25, 5, 15, 5, 5, 10] : [5, 10, 15, 25, 45, 5, 5, 5];
  if (selected === "salad" || selected === "pizza") {
    return {
      winner: selected,
      label: selected === "salad" ? "Salad" : "Pizza",
      specialResult: true,
      poolAmount,
    };
  }
  return {
    winner: selected, label: labels[selected], multiplier: multipliers[selected], specialResult: false,
    poolAmount,
  };
}

function greatestCommonDivisor(left: number, right: number): number {
  return right === 0 ? left : greatestCommonDivisor(right, left % right);
}

function validateSharedBets(game: SharedRoundGame, input: Record<string, number>, config: GameRuntimeConfig) {
  const unit = config.denominations.reduce(greatestCommonDivisor);
  const validate = (keys: readonly string[]) => {
    const checked = checkedBets(input, keys, unit, config.maximumBet);
    if (checked.total > 0 && checked.total < config.minimumBet) throw new Error(`The minimum bet is ${config.minimumBet} coins.`);
    return checked;
  };
  if (game === "luck77") return validate(["watermelon", "seven", "plum"]);
  if (game === "bounty_football") return validate(footballMultipliers.map((_, index) => String(index)));
  const count = game === "greedy_lion" ? 8 : 10;
  return validate(Array.from({ length: count }, (_, index) => String(index)));
}

function sharedRoundSettlement(game: SharedRoundGame, bets: Record<string, number>, outcome: Record<string, unknown>, config: GameRuntimeConfig): ServerGameOutcome {
  const checked = validateSharedBets(game, bets, config);
  if (game === "luck77") {
    const winner = String(outcome.winner);
    const multiplier = winner === "seven" ? 8 : 2;
    return { outcome, wager: checked.total, payout: Number(checked.bets[winner] ?? 0) * multiplier };
  }
  if (game === "bounty_football") {
    const winner = Number(outcome.winner);
    const multiplier = Number(footballMultipliers[winner] ?? 0);
    return { outcome, wager: checked.total, payout: Number(checked.bets[String(winner)] ?? 0) * multiplier, commissionablePayout: 0 };
  }
  const configuredOutcome = outcome.specialResult === true
    ? String(outcome.winner) as "salad" | "pizza"
    : Number(outcome.winner);
  return evaluateGreedyRound(game, checked.bets, configuredOutcome);
}

async function ensureSharedRound(connection: PoolConnection, game: SharedRoundGame, config: GameRuntimeConfig, now = new Date()) {
  if (!config.enabled) throw new Error("This game is currently disabled.");
  if (config.maintenance) throw new Error("This game is temporarily under maintenance.");
  const timing = { betting: config.bettingSeconds, drawing: config.drawingSeconds, result: config.resultSeconds };
  const totalSeconds = timing.betting + timing.drawing + timing.result;
  if (totalSeconds < 1) throw new Error("This shared game has an invalid round duration.");
  const roundNumber = Math.floor(now.getTime() / (totalSeconds * 1000));
  const startsAt = new Date(roundNumber * totalSeconds * 1000);
  const bettingEndsAt = new Date(startsAt.getTime() + timing.betting * 1000);
  const drawingEndsAt = new Date(bettingEndsAt.getTime() + timing.drawing * 1000);
  const resultEndsAt = new Date(drawingEndsAt.getTime() + timing.result * 1000);
  await connection.execute(
    `INSERT IGNORE INTO game_shared_rounds
      (id, game_name, round_number, betting_starts_at, betting_ends_at, drawing_ends_at, result_ends_at, outcome_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), game, roundNumber, startsAt, bettingEndsAt, drawingEndsAt, resultEndsAt, JSON.stringify(await sharedRoundOutcome(connection, game, config))],
  );
  const [rows] = await connection.query<SharedRoundRow[]>(
    "SELECT * FROM game_shared_rounds WHERE game_name = ? AND round_number = ? LIMIT 1 FOR UPDATE",
    [game, roundNumber],
  );
  if (!rows[0]) throw new Error("The shared game round could not be opened.");
  const outcome = asObject(rows[0].outcome_json);
  if ((game === "greedy_lion" || game === "greedy_king") && outcome.specialResult === true) {
    await connection.execute(
      "UPDATE game_progressive_pools SET last_special_round_id = ? WHERE game_name = ?",
      [rows[0].id, game],
    );
  }
  return rows[0];
}

function sharedPhase(round: SharedRoundRow, now: Date) {
  if (now < new Date(round.betting_ends_at)) return { phase: "BETTING", phaseEndsAt: new Date(round.betting_ends_at) };
  if (now < new Date(round.drawing_ends_at)) return { phase: "DRAWING", phaseEndsAt: new Date(round.drawing_ends_at) };
  return { phase: "RESULT", phaseEndsAt: new Date(round.result_ends_at) };
}

async function settleMaturedSharedRounds(connection: PoolConnection, game: SharedRoundGame) {
  const settings = await gameSettings(connection);
  const gameConfig = settings.games[game];
  const [pairs] = await connection.query<(RowDataPacket & { round_id: string; application_user_id: string })[]>(
    `SELECT DISTINCT bet.round_id, bet.application_user_id
     FROM game_shared_bets bet
     INNER JOIN game_shared_rounds round ON round.id = bet.round_id
     LEFT JOIN game_shared_settlements settlement
       ON settlement.round_id = bet.round_id AND settlement.application_user_id = bet.application_user_id
     WHERE round.game_name = ? AND round.drawing_ends_at <= UTC_TIMESTAMP(3) AND settlement.id IS NULL
     ORDER BY bet.round_id LIMIT 200`,
    [game],
  );
  for (const pair of pairs) {
    await connection.query(
      "SELECT id FROM game_shared_bet_requests WHERE round_id = ? AND application_user_id = ? FOR UPDATE",
      [pair.round_id, pair.application_user_id],
    );
    const [alreadyRows] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM game_shared_settlements WHERE round_id = ? AND application_user_id = ? LIMIT 1",
      [pair.round_id, pair.application_user_id],
    );
    if (alreadyRows[0]) continue;
    const [roundRows] = await connection.query<SharedRoundRow[]>("SELECT * FROM game_shared_rounds WHERE id = ? LIMIT 1", [pair.round_id]);
    const round = roundRows[0];
    if (!round) continue;
    const [betRows] = await connection.query<(RowDataPacket & { target_id: string; amount: number })[]>(
      "SELECT target_id, SUM(amount) amount FROM game_shared_bets WHERE round_id = ? AND application_user_id = ? GROUP BY target_id",
      [pair.round_id, pair.application_user_id],
    );
    const bets = Object.fromEntries(betRows.map((row) => [String(row.target_id), Number(row.amount)]));
    const result = sharedRoundSettlement(game, bets, asObject(round.outcome_json), gameConfig);
    const rules = gameEconomyRules(settings);
    const deductionRate = game === "bounty_football" ? 0 : rules.winningsDeductionRate;
    const grossPayout = result.payout;
    const deduction = grossPayout > result.wager && deductionRate > 0 ? Math.floor(grossPayout * deductionRate) : 0;
    const payout = grossPayout - deduction;
    await connection.execute(
      "INSERT INTO wallet_balances (id, owner_type, owner_id, asset_type) VALUES (?, 'APPLICATION_USER', ?, 'COIN') ON DUPLICATE KEY UPDATE available_balance = available_balance",
      [randomUUID(), pair.application_user_id],
    );
    const [walletRows] = await connection.query<(RowDataPacket & { id: string; available_balance: number })[]>(
      "SELECT id, available_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' LIMIT 1 FOR UPDATE",
      [pair.application_user_id],
    );
    if (!walletRows[0]) throw new Error("The game wallet is unavailable.");
    const balanceAfter = Number(walletRows[0].available_balance) + payout;
    if (payout > 0) {
      await connection.execute("UPDATE wallet_balances SET available_balance = ? WHERE id = ?", [balanceAfter, walletRows[0].id]);
      await connection.execute(
        `INSERT INTO ledger_transactions
          (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, destination_type, destination_id, amount, status, reason, metadata)
         VALUES (?, ?, ?, 'COIN', 'GAME_CREDIT', 'GAME', 'APPLICATION_USER', ?, ?, 'COMPLETED', ?, ?)`,
        [randomUUID(), code("GSC"), `SHARED_GAME:${round.id}:${pair.application_user_id}:CREDIT`, pair.application_user_id, payout, `${game} shared round payout`, JSON.stringify({ game, sharedRoundId: round.id, grossPayout, deduction, rate: deductionRate })],
      );
    }
    if (deduction > 0) {
      await connection.execute(
        `INSERT INTO ledger_transactions
          (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, destination_type, amount, status, reason, metadata)
         VALUES (?, ?, ?, 'COIN', 'GAME_WITHHOLDING', 'GAME', 'PLATFORM', ?, 'COMPLETED', ?, ?)`,
        [randomUUID(), code("GSW"), `SHARED_GAME:${round.id}:${pair.application_user_id}:WITHHOLDING`, deduction, `${game} shared-round winnings deduction`, JSON.stringify({ game, sharedRoundId: round.id, grossPayout, netPayout: payout, rate: deductionRate })],
      );
    }
    const resultId = randomUUID();
    const clientRoundId = randomUUID();
    const fullOutcome = {
      ...asObject(round.outcome_json), sharedRoundId: round.id, roundNumber: Number(round.round_number),
      grossPayout, winningsDeduction: deduction, winningsDeductionRate: deductionRate, netPayout: payout,
    };
    await connection.execute(
      `INSERT INTO game_round_results
        (id, client_round_id, application_user_id, game_name, bets_json, outcome_json, wager_total, payout_total, balance_after)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [resultId, clientRoundId, pair.application_user_id, game, JSON.stringify(bets), JSON.stringify(fullOutcome), result.wager, payout, balanceAfter],
    );
    await connection.execute(
      `INSERT INTO game_shared_settlements
        (id, round_id, application_user_id, wager_total, gross_payout, deduction_total, payout_total, balance_after, result_record_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), round.id, pair.application_user_id, result.wager, grossPayout, deduction, payout, balanceAfter, resultId],
    );
    if (payout >= gameConfig.bigWinThreshold) {
      await connection.execute(
        `INSERT IGNORE INTO game_big_winner_events
          (id, result_record_id, application_user_id, game_name, payout_total, outcome_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [randomUUID(), resultId, pair.application_user_id, game, payout, JSON.stringify(fullOutcome)],
      );
    }
  }
}

async function sharedRoundStatePayload(
  connection: PoolConnection,
  identity: MobileIdentity,
  round: SharedRoundRow,
  config: GameRuntimeConfig,
  now = new Date(),
) {
  const game = round.game_name;
  const targets = game === "luck77"
    ? ["watermelon", "seven", "plum"]
    : game === "bounty_football"
      ? footballMultipliers.map((_, index) => String(index))
      : Array.from({ length: game === "greedy_lion" ? 8 : 10 }, (_, index) => String(index));
  const [totalRows, myRows, walletRows, playerRows, settlementRows, recentRows] = await Promise.all([
    connection.query<(RowDataPacket & { target_id: string; amount: number })[]>(
      "SELECT target_id, SUM(amount) amount FROM game_shared_bets WHERE round_id = ? GROUP BY target_id", [round.id]),
    connection.query<(RowDataPacket & { target_id: string; amount: number })[]>(
      "SELECT target_id, SUM(amount) amount FROM game_shared_bets WHERE round_id = ? AND application_user_id = ? GROUP BY target_id", [round.id, identity.userId]),
    connection.query<(RowDataPacket & { available_balance: number })[]>(
      "SELECT available_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' LIMIT 1", [identity.userId]),
    connection.query<(RowDataPacket & { total: number })[]>(
      "SELECT COUNT(DISTINCT application_user_id) total FROM game_shared_bets WHERE round_id = ?", [round.id]),
    connection.query<RowDataPacket[]>(
      "SELECT wager_total, gross_payout, deduction_total, payout_total, balance_after, settled_at FROM game_shared_settlements WHERE round_id = ? AND application_user_id = ? LIMIT 1", [round.id, identity.userId]),
    connection.query<SharedRoundRow[]>(
      `SELECT * FROM game_shared_rounds WHERE game_name = ? AND drawing_ends_at <= UTC_TIMESTAMP(3)
       ORDER BY round_number DESC LIMIT ?`, [game, config.historyLength]),
  ]);
  const [bigWinnerRows, playerListRows, poolRows] = await Promise.all([
    connection.query<RowDataPacket[]>(
      `SELECT event.id, event.payout_total, event.outcome_json, event.created_at,
              user.public_id, user.full_name, user.avatar_url, avatar.updated_at avatar_updated_at,
              LEAST(120, FLOOR(SQRT(GREATEST(0, user.consumption_points) / 500)) + 1) consumption_level
       FROM game_big_winner_events event
       INNER JOIN application_users user ON user.id = event.application_user_id
       LEFT JOIN application_user_avatars avatar ON avatar.application_user_id = user.id
       WHERE event.game_name = ?
       ORDER BY event.created_at DESC, event.id DESC LIMIT 10`,
      [game],
    ),
    connection.query<RowDataPacket[]>(
      `SELECT user.public_id, user.full_name, user.avatar_url, avatar.updated_at avatar_updated_at
       FROM game_shared_bets bet
       INNER JOIN application_users user ON user.id = bet.application_user_id
       LEFT JOIN application_user_avatars avatar ON avatar.application_user_id = user.id
       WHERE bet.round_id = ?
       GROUP BY user.id, user.public_id, user.full_name, user.avatar_url, avatar.updated_at
       ORDER BY MIN(bet.created_at), user.public_id LIMIT 50`,
      [round.id],
    ),
    game === "greedy_lion" || game === "greedy_king"
      ? connection.query<(RowDataPacket & { amount: number })[]>(
          "SELECT amount FROM game_progressive_pools WHERE game_name = ? LIMIT 1",
          [game],
        )
      : Promise.resolve([[], []] as unknown as Awaited<ReturnType<PoolConnection["query"]>>),
  ]);
  const totalMap = Object.fromEntries(totalRows[0].map((row) => [String(row.target_id), Number(row.amount)]));
  const myMap = Object.fromEntries(myRows[0].map((row) => [String(row.target_id), Number(row.amount)]));
  const phase = sharedPhase(round, now);
  const reveal = now >= new Date(round.drawing_ends_at);
  const settlement = settlementRows[0][0];
  return {
    game,
    serverTimestamp: now.toISOString(),
    round: {
      id: round.id, number: Number(round.round_number), phase: phase.phase,
      phaseEndsAt: phase.phaseEndsAt.toISOString(), bettingEndsAt: new Date(round.betting_ends_at).toISOString(),
    },
    targetTotals: Object.fromEntries(targets.map((target) => [target, Number(totalMap[target] ?? 0)])),
    myBets: Object.fromEntries(targets.map((target) => [target, Number(myMap[target] ?? 0)])),
    walletBalance: Number(walletRows[0][0]?.available_balance ?? 0),
    playerCount: Number(playerRows[0][0]?.total ?? 0),
    players: playerListRows[0].map((item) => ({
      publicId: String(item.public_id), name: String(item.full_name), avatarUrl: mobileAvatarUrl(item),
    })),
    progressivePool: Number((poolRows[0] as (RowDataPacket & { amount?: number })[])[0]?.amount ?? 0),
    controls: {
      enabled: config.enabled, maintenance: config.maintenance,
      denominations: config.denominations, minimumBet: config.minimumBet,
      maximumBet: config.maximumBet, repeatBet: config.repeatBet, autoPlay: config.autoPlay,
    },
    outcome: reveal ? asObject(round.outcome_json) : null,
    settlement: settlement ? {
      wager: Number(settlement.wager_total), grossPayout: Number(settlement.gross_payout),
      deduction: Number(settlement.deduction_total), payout: Number(settlement.payout_total),
      balance: Number(settlement.balance_after), settledAt: new Date(settlement.settled_at as Date).toISOString(),
    } : null,
    recentResults: recentRows[0].map((item) => ({
      roundId: item.id, roundNumber: Number(item.round_number), outcome: asObject(item.outcome_json),
    })),
    bigWinners: bigWinnerRows[0].map((item) => ({
      id: String(item.id), publicId: String(item.public_id), name: String(item.full_name),
      avatarUrl: mobileAvatarUrl(item), userLevel: Number(item.consumption_level ?? 1),
      game, payout: Number(item.payout_total), outcome: asObject(item.outcome_json),
      createdAt: new Date(item.created_at as Date).toISOString(),
    })),
  };
}

export async function gameSharedRoundState(identity: MobileIdentity, gameValue: string) {
  const game = sharedGame(gameValue);
  return withTransaction(async (connection) => {
    await settleMaturedSharedRounds(connection, game);
    const now = new Date();
    const config = (await gameSettings(connection)).games[game];
    const round = await ensureSharedRound(connection, game, config, now);
    return sharedRoundStatePayload(connection, identity, round, config, now);
  });
}

export async function placeSharedGameBets(identity: MobileIdentity, input: {
  requestId: string; game: string; roundId: string; bets: Record<string, number>;
}) {
  const game = sharedGame(input.game);
  const bets = canonicalBets(input.bets);
  return withTransaction(async (connection) => {
    await settleMaturedSharedRounds(connection, game);
    const now = new Date();
    const config = (await gameSettings(connection)).games[game];
    const round = await ensureSharedRound(connection, game, config, now);
    if (round.id !== input.roundId || now >= new Date(round.betting_ends_at)) throw new Error("Betting has closed for this round.");
    const [existingRows] = await connection.query<(RowDataPacket & { round_id: string; bets_json: unknown })[]>(
      "SELECT round_id, bets_json FROM game_shared_bet_requests WHERE application_user_id = ? AND request_id = ? LIMIT 1 FOR UPDATE",
      [identity.userId, input.requestId],
    );
    if (existingRows[0]) {
      if (String(existingRows[0].round_id) !== round.id || JSON.stringify(canonicalBets(asObject(existingRows[0].bets_json) as Record<string, number>)) !== JSON.stringify(bets)) {
        throw new Error("This bet request ID was already used.");
      }
      return sharedRoundStatePayload(connection, identity, round, config, now);
    }
    const checked = validateSharedBets(game, bets, config);
    if (checked.total <= 0) throw new Error("Choose a positive game bet.");
    const [roundWagerRows] = await connection.query<(RowDataPacket & { total: number })[]>(
      `SELECT COALESCE(SUM(wager_total), 0) total
       FROM game_shared_bet_requests
       WHERE round_id = ? AND application_user_id = ?`,
      [round.id, identity.userId],
    );
    const roundWager = Number(roundWagerRows[0]?.total ?? 0);
    if (!Number.isSafeInteger(roundWager) || roundWager + checked.total > config.maximumBet) {
      throw new Error(`The ${config.maximumBet} coin round limit has been reached.`);
    }
    await connection.execute(
      "INSERT INTO wallet_balances (id, owner_type, owner_id, asset_type) VALUES (?, 'APPLICATION_USER', ?, 'COIN') ON DUPLICATE KEY UPDATE available_balance = available_balance",
      [randomUUID(), identity.userId],
    );
    const [walletRows] = await connection.query<(RowDataPacket & { id: string; available_balance: number })[]>(
      "SELECT id, available_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' LIMIT 1 FOR UPDATE",
      [identity.userId],
    );
    if (!walletRows[0] || Number(walletRows[0].available_balance) < checked.total) throw new Error("Not enough coins.");
    await connection.execute("UPDATE wallet_balances SET available_balance = available_balance - ? WHERE id = ?", [checked.total, walletRows[0].id]);
    const ledgerId = randomUUID();
    await connection.execute(
      `INSERT INTO ledger_transactions
        (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, source_id, destination_type, amount, status, reason, metadata)
       VALUES (?, ?, ?, 'COIN', 'GAME_DEBIT', 'APPLICATION_USER', ?, 'GAME', ?, 'COMPLETED', ?, ?)`,
      [ledgerId, code("GSB"), `SHARED_BET:${identity.userId}:${input.requestId}`, identity.userId, checked.total, `${game} shared bet`, JSON.stringify({ game, sharedRoundId: round.id, requestId: input.requestId, bets: checked.bets })],
    );
    const requestRowId = randomUUID();
    await connection.execute(
      `INSERT INTO game_shared_bet_requests
        (id, request_id, round_id, application_user_id, bets_json, wager_total, ledger_transaction_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [requestRowId, input.requestId, round.id, identity.userId, JSON.stringify(checked.bets), checked.total, ledgerId],
    );
    for (const [target, amount] of Object.entries(checked.bets)) {
      if (amount <= 0) continue;
      await connection.execute(
        "INSERT INTO game_shared_bets (id, request_id, round_id, application_user_id, target_id, amount) VALUES (?, ?, ?, ?, ?, ?)",
        [randomUUID(), requestRowId, round.id, identity.userId, target, amount],
      );
    }
    if ((game === "greedy_lion" || game === "greedy_king") && Number(config.poolContributionBps ?? 0) > 0) {
      const contribution = Math.floor(checked.total * Number(config.poolContributionBps) / 10_000);
      if (contribution > 0) {
        await connection.execute(
          `UPDATE game_progressive_pools
           SET amount = amount + ?, total_contributed = total_contributed + ?
           WHERE game_name = ?`,
          [contribution, contribution, game],
        );
      }
    }
    return sharedRoundStatePayload(connection, identity, round, config, now);
  });
}

function gameRoundResponse(row: RowDataPacket) {
  return {
    success: true,
    roundId: String(row.id),
    clientRoundId: String(row.client_round_id),
    game: String(row.game_name),
    bets: asObject(row.bets_json),
    outcome: asObject(row.outcome_json),
    wager: Number(row.wager_total),
    payout: Number(row.payout_total),
    coinBalance: Number(row.balance_after),
    createdAt: new Date(row.created_at as string | Date).toISOString(),
  };
}

export async function settleGameRound(identity: MobileIdentity, input: ServerGameRoundInput) {
  if (!supportedRoundGames.has(input.game)) throw new Error("This game is unavailable.");
  if (sharedRoundGames.has(input.game)) throw new Error("Update Nazraa to play this shared game.");
  const bets = canonicalBets(input.bets);
  return withTransaction(async (connection) => {
    // Lock the existing wallet first for every round. Concurrent retries must
    // wait here BEFORE checking the idempotency record, not race on a missing
    // result-row gap lock and deadlock at the debit.
    // INSERT IGNORE takes a shared duplicate-key lock; concurrent calls then
    // deadlock upgrading it. This no-op upsert acquires the exclusive lock.
    await connection.execute(
      "INSERT INTO wallet_balances (id, owner_type, owner_id, asset_type) VALUES (?, 'APPLICATION_USER', ?, 'COIN') ON DUPLICATE KEY UPDATE available_balance = available_balance",
      [randomUUID(), identity.userId],
    );
    const [walletRows] = await connection.query<(RowDataPacket & { id: string; available_balance: number })[]>(
      "SELECT id, available_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' LIMIT 1 FOR UPDATE",
      [identity.userId],
    );
    const before = Number(walletRows[0].available_balance);
    const [existingRows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM game_round_results WHERE application_user_id = ? AND client_round_id = ? LIMIT 1 FOR UPDATE",
      [identity.userId, input.clientRoundId],
    );
    if (existingRows[0]) {
      const existing = existingRows[0];
      if (String(existing.game_name) !== input.game || JSON.stringify(canonicalBets(asObject(existing.bets_json) as Record<string, number>)) !== JSON.stringify(bets)) {
        throw new Error("This game round ID was already used.");
      }
      // The result is immutable, but a retry after another gift/round must
      // never roll the app's visible wallet back to the old balance_after.
      return { ...gameRoundResponse(existing), coinBalance: before };
    }

    const [gameSettingRows] = await connection.query<(RowDataPacket & { setting_value: unknown })[]>(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.games' LIMIT 1",
    );
    const mobileGames = mobileGamesConfig(gameSettingRows[0]?.setting_value);
    const rules = gameEconomyRules(mobileGames);
    const runtimeConfig = input.game === "jungle_hunt" ? mobileGames.games.jungle_hunt : undefined;
    if (runtimeConfig && !runtimeConfig.enabled) throw new Error("This game is currently disabled.");
    if (runtimeConfig?.maintenance) throw new Error("This game is temporarily under maintenance.");
    const targetWin = targetPlayerWin(rules.targetWinRate);
    const result = createServerGameOutcome(input.game, bets, targetWin, runtimeConfig);
    const grossPayout = result.payout;
    const commissionablePayout = result.commissionablePayout;
    const effectiveDeductionRate = input.game === "bounty_football" ? 0 : rules.winningsDeductionRate;
    const winningsDeduction = commissionablePayout == null
      ? grossPayout > result.wager
        ? Math.floor(grossPayout * effectiveDeductionRate)
        : 0
      : commissionablePayout > 0 && effectiveDeductionRate > 0
        ? Math.max(1, Math.floor(commissionablePayout * effectiveDeductionRate))
        : 0;
    result.payout = grossPayout - winningsDeduction;
    result.outcome = {
      ...result.outcome,
      grossPayout,
      commissionablePayout: commissionablePayout ?? grossPayout,
      winningsDeduction,
      winningsDeductionRate: effectiveDeductionRate,
      netPayout: result.payout,
    };
    if (before < result.wager) throw new Error("Not enough coins.");
    const after = before - result.wager + result.payout;
    if (!Number.isSafeInteger(after) || after < 0) throw new Error("The game result could not be settled.");
    await connection.execute("UPDATE wallet_balances SET available_balance = ? WHERE id = ?", [after, walletRows[0].id]);

    if (result.wager > 0) {
      await connection.execute(
        `INSERT INTO ledger_transactions
         (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, source_id, destination_type, amount, status, reason, metadata)
         VALUES (?, ?, ?, 'COIN', 'GAME_DEBIT', 'APPLICATION_USER', ?, 'GAME', ?, 'COMPLETED', ?, ?)`,
        [randomUUID(), code("GMD"), `GAME_ROUND:${identity.userId}:${input.clientRoundId}:DEBIT`, identity.userId, result.wager, `${input.game} round wager`, JSON.stringify({ game: input.game, clientRoundId: input.clientRoundId, bets })],
      );
    }
    if (result.payout > 0) {
      await connection.execute(
        `INSERT INTO ledger_transactions
         (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, destination_type, destination_id, amount, status, reason, metadata)
         VALUES (?, ?, ?, 'COIN', 'GAME_CREDIT', 'GAME', 'APPLICATION_USER', ?, ?, 'COMPLETED', ?, ?)`,
        [randomUUID(), code("GMC"), `GAME_ROUND:${identity.userId}:${input.clientRoundId}:CREDIT`, identity.userId, result.payout, `${input.game} round net payout`, JSON.stringify({ game: input.game, clientRoundId: input.clientRoundId, grossPayout, winningsDeduction, winningsDeductionRate: effectiveDeductionRate })],
      );
    }
    if (winningsDeduction > 0) {
      await connection.execute(
        `INSERT INTO ledger_transactions
         (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, destination_type, amount, status, reason, metadata)
         VALUES (?, ?, ?, 'COIN', 'GAME_WITHHOLDING', 'GAME', 'PLATFORM', ?, 'COMPLETED', ?, ?)`,
        [randomUUID(), code("GMW"), `GAME_ROUND:${identity.userId}:${input.clientRoundId}:WITHHOLDING`, winningsDeduction, `${input.game} winnings deduction`, JSON.stringify({ game: input.game, clientRoundId: input.clientRoundId, grossPayout, netPayout: result.payout, rate: effectiveDeductionRate })],
      );
    }

    const id = randomUUID();
    const now = new Date();
    await connection.execute(
      `INSERT INTO game_round_results
       (id, client_round_id, application_user_id, game_name, bets_json, outcome_json, wager_total, payout_total, balance_after, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.clientRoundId, identity.userId, input.game, JSON.stringify(bets), JSON.stringify(result.outcome), result.wager, result.payout, after, now],
    );
    if (runtimeConfig && result.payout >= runtimeConfig.bigWinThreshold) {
      await connection.execute(
        `INSERT IGNORE INTO game_big_winner_events
          (id, result_record_id, application_user_id, game_name, payout_total, outcome_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), id, identity.userId, input.game, result.payout, JSON.stringify(result.outcome), now],
      );
    }
    return gameRoundResponse({
      id, client_round_id: input.clientRoundId, game_name: input.game, bets_json: bets,
      outcome_json: result.outcome, wager_total: result.wager, payout_total: result.payout,
      balance_after: after, created_at: now,
    } as RowDataPacket);
  });
}

export async function gameSocialState(game: string) {
  if (!supportedRoundGames.has(game)) throw new Error("This game is unavailable.");
  const connection = await db().getConnection();
  try {
    const settings = await gameSettings(connection);
    const configured = settings.games[game as keyof typeof settings.games];
    const [winnerRows, playerRows] = await Promise.all([
      connection.query<RowDataPacket[]>(
        `SELECT event.id, event.payout_total, event.outcome_json, event.created_at,
                user.public_id, user.full_name, user.avatar_url, avatar.updated_at avatar_updated_at,
                LEAST(120, FLOOR(SQRT(GREATEST(0, user.consumption_points) / 500)) + 1) consumption_level
         FROM game_big_winner_events event
         INNER JOIN application_users user ON user.id = event.application_user_id
         LEFT JOIN application_user_avatars avatar ON avatar.application_user_id = user.id
         WHERE event.game_name = ?
         ORDER BY event.created_at DESC, event.id DESC LIMIT 10`,
        [game],
      ),
      connection.query<(RowDataPacket & { total: number })[]>(
        `SELECT COUNT(DISTINCT application_user_id) total
         FROM game_round_results
         WHERE game_name = ? AND created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE)`,
        [game],
      ),
    ]);
    return {
      game,
      playerCount: Number(playerRows[0][0]?.total ?? 0),
      controls: configured ? {
        enabled: configured.enabled, maintenance: configured.maintenance,
        denominations: configured.denominations, minimumBet: configured.minimumBet,
        maximumBet: configured.maximumBet, repeatBet: configured.repeatBet,
        autoPlay: configured.autoPlay,
      } : null,
      bigWinners: winnerRows[0].map((item) => ({
        id: String(item.id), publicId: String(item.public_id), name: String(item.full_name),
        avatarUrl: mobileAvatarUrl(item), userLevel: Number(item.consumption_level ?? 1),
        game, payout: Number(item.payout_total), outcome: asObject(item.outcome_json),
        createdAt: new Date(item.created_at as Date).toISOString(),
      })),
    };
  } finally {
    connection.release();
  }
}

export async function gameRoundHistory(identity: MobileIdentity, game: string, limit = 10) {
  if (!supportedRoundGames.has(game)) throw new Error("This game is unavailable.");
  const [rows] = await db().query<RowDataPacket[]>(
    `SELECT * FROM game_round_results
     WHERE application_user_id = ? AND game_name = ?
     ORDER BY created_at DESC, id DESC LIMIT ?`,
    [identity.userId, game, Math.max(1, Math.min(20, limit))],
  );
  return { rounds: rows.map(gameRoundResponse) };
}

export async function gameRoundLeaderboard(
  game: string,
  limit = 10,
  period: "round" | "daily" | "weekly" | "monthly" = "daily",
) {
  if (!supportedRoundGames.has(game)) throw new Error("This game is unavailable.");
  const sharedLeaderboard = sharedRoundGames.has(game);
  const periodFilter = period === "round" && sharedLeaderboard
    ? `JSON_UNQUOTE(JSON_EXTRACT(result.outcome_json, '$.sharedRoundId')) =
       (SELECT latest.id FROM game_shared_rounds latest
        WHERE latest.game_name = ? AND latest.drawing_ends_at <= UTC_TIMESTAMP(3)
        ORDER BY latest.round_number DESC LIMIT 1)`
    : period === "round"
      ? `result.created_at >= DATE_SUB(
           (SELECT MAX(latest.created_at) FROM game_round_results latest
            WHERE latest.game_name = ? AND latest.wager_total > 0),
           INTERVAL 25 SECOND)`
    : period === "weekly"
      ? "result.created_at >= DATE_SUB(CURRENT_DATE, INTERVAL WEEKDAY(CURRENT_DATE) DAY)"
      : period === "monthly"
        ? "result.created_at >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')"
        : "result.created_at >= CURRENT_DATE AND result.created_at < DATE_ADD(CURRENT_DATE, INTERVAL 1 DAY)";
  const [rows] = await db().query<RowDataPacket[]>(
    `SELECT user.public_id, user.full_name, user.avatar_url,
            avatar.updated_at avatar_updated_at, user.country_code,
            COUNT(*) rounds, SUM(result.wager_total) total_wager,
            SUM(result.payout_total) total_payout,
            SUM(CAST(result.payout_total AS SIGNED) - CAST(result.wager_total AS SIGNED)) net_winnings
     FROM game_round_results result
     INNER JOIN application_users user ON user.id = result.application_user_id
     LEFT JOIN application_user_avatars avatar ON avatar.application_user_id = user.id
     WHERE result.game_name = ? AND result.wager_total > 0
       AND ${periodFilter}
     GROUP BY user.id, user.public_id, user.full_name, user.avatar_url,
              avatar.updated_at, user.country_code
     ORDER BY net_winnings DESC, total_payout DESC, MIN(result.created_at), user.public_id
     LIMIT ?`,
    period === "round"
      ? [game, game, Math.max(1, Math.min(20, limit))]
      : [game, Math.max(1, Math.min(20, limit))],
  );
  return {
    period,
    entries: rows.map((row, index) => ({
      rank: index + 1,
      publicId: String(row.public_id),
      name: String(row.full_name),
      avatarUrl: mobileAvatarUrl(row),
      countryCode: row.country_code ? String(row.country_code) : null,
      rounds: Number(row.rounds),
      totalWager: Number(row.total_wager),
      totalPayout: Number(row.total_payout),
      netWinnings: Number(row.net_winnings),
    })),
  };
}

async function ensureWallet(connection: PoolConnection, ownerId: string, assetType: "COIN" | "DIAMOND") {
  await connection.execute("INSERT IGNORE INTO wallet_balances (id, owner_type, owner_id, asset_type) VALUES (?, 'APPLICATION_USER', ?, ?)", [randomUUID(), ownerId, assetType]);
}
