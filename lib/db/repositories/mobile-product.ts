import "server-only";

import { randomInt, randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { publicImageFromDataUrl } from "@/lib/security/public-images";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { permissionsForMobileRole } from "@/lib/auth/mobile-session";
import { encryptPrivateText } from "@/lib/security/documents";
import { mobileCompletionSnapshot } from "@/lib/db/repositories/mobile-completion";
import { recordRocketGift } from "@/lib/db/repositories/mobile-rewards";
import { LiveAccessPolicyService } from "@/lib/services/live-access-policy";

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
           SELECT 1 FROM live_room_members owner
           WHERE owner.room_id = room.id AND owner.room_role = 'OWNER' AND owner.left_at IS NULL
             AND owner.last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 2 MINUTE
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
         AND EXISTS (SELECT 1 FROM live_room_members owner WHERE owner.room_id = room.id AND owner.room_role = 'OWNER' AND owner.left_at IS NULL AND owner.last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 2 MINUTE)
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
  const [rows] = await activeRoomRows(after);
  return rows.map((row) => mapActiveRoom(row));
}

export async function mobileBootstrap(identity: MobileIdentity) {
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
    consumptionLevel: levelProgress(Number(profile.consumption_points), "consumption", maximumConsumptionLevel),
    anchorIncomeLevel: levelProgress(Number(profile.anchor_income_points), "anchorIncome", maximumActorLevel),
    rankings: rankingRows[0].map((row, index) => ({ rank: index + 1, user: { id: String(row.public_id), name: String(row.full_name), level: Number(row.level_number), vip: Number(row.vip_tier), role: "user" }, score: Number(row.consumption_points), label: "Consumption" })),
    agencyRankings: agencyRankingRows[0].map((row, index) => ({ rank: index + 1, agency: { id: String(row.public_id), code: String(row.public_id), name: String(row.full_name), country: "", ownerUserId: "0", status: "ACTIVE", hosts: [], targetProgress: 0, estimatedEarnings: Number(row.score), totalLiveMinutes: 0 }, score: Number(row.score), label: "Agency" })),
    posts: completion.posts,
    role: roleName,
    permissions: permissionsForMobileRole(identity.role),
  };
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
} | { type: "BANK"; accountHolderName: string; accountNumber: string; ifsc: string; bankName: string }) {
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
    const destination = payout.type === "UPI"
      ? `UPI ID: ${payout.upiId}`
      : `Account number: ${payout.accountNumber}\nIFSC: ${payout.ifsc}\nBank: ${payout.bankName}`;
    const lastFour = (payout.type === "UPI" ? payout.upiId : payout.accountNumber).replace(/\s/g, "").slice(-4);
    const masked = payout.type === "UPI"
      ? `${payout.upiId.slice(0, 1)}•••${payout.upiId.slice(payout.upiId.indexOf("@"))}`
      : `•••• ${lastFour} • ${payout.ifsc}`;
    const protectedValue = encryptPrivateText(destination);
    const payoutMethodId = randomUUID();
    await connection.execute(
      `INSERT INTO payout_methods
        (id, application_user_id, method_type, display_name, masked_destination, destination_encrypted, destination_iv, destination_tag, active, verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, FALSE)`,
      [payoutMethodId, identity.userId, payout.type, payout.accountHolderName, masked, protectedValue.encryptedData, protectedValue.iv, protectedValue.tag],
    );
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

export async function sendGift(identity: MobileIdentity, input: { roomCode: string; giftId: string; recipientPublicId: string; quantity: number }) {
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 99) throw new Error("Choose a valid gift quantity.");
  return withTransaction(async (connection) => {
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
      `INSERT INTO ledger_transactions (id, transaction_code, asset_type, transaction_type, source_type, source_id, destination_type, destination_id, amount, status, reason)
       VALUES (?, ?, 'COIN', 'GIFT_SPEND', 'APPLICATION_USER', ?, 'APPLICATION_USER', ?, ?, 'COMPLETED', ?)`,
      [randomUUID(), `${transferCode}-S`, identity.userId, recipient.id, total, `${gift.name} ×${input.quantity}`],
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
const goldenSingleGames = new Set(["food_wheel", "cat_wheel", "deep_sea", "card_arena"]);
const goldenZoneGames = new Set(["greedy_king", "greedy_lion"]);
const supportedRoundGames = new Set([
  teenPattiGame,
  "luck77",
  "bounty_football",
  "jungle_hunt",
  ...goldenSingleGames,
  "three_card",
  ...goldenZoneGames,
]);
const footballMultipliers = [2, 5, 8, 18, 66, 50, 100, 88, 30, 20] as const;
const junglePaylines = [
  [0, 0, 0, 0, 0], [1, 1, 1, 1, 1], [2, 2, 2, 2, 2], [0, 1, 2, 2, 1], [2, 1, 0, 0, 1],
  [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 1, 2], [1, 2, 2, 1, 0], [0, 1, 1, 0, 0],
  [2, 1, 1, 2, 2], [1, 0, 1, 2, 1], [1, 2, 1, 0, 1], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
] as const;
const jungleSymbols = ["ten", "crocodile", "rhino", "elephant"] as const;

type ServerGameRoundInput = {
  clientRoundId: string;
  game: string;
  bets: Record<string, number>;
};

type ServerGameOutcome = {
  outcome: Record<string, unknown>;
  wager: number;
  payout: number;
};

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
  if (counts.size === 1) return { category: "trail", label: "Three of a Kind", multiplier: 25 };
  if (flush && sequence) return { category: "pureSequence", label: "Straight Flush", multiplier: 10 };
  if (sequence) return { category: "sequence", label: "Straight", multiplier: 2 };
  if (flush) return { category: "color", label: "Flush", multiplier: 4 };
  if ([...counts.values()].includes(2)) return { category: "pair", label: "Pair", multiplier: 0 };
  return { category: "highCard", label: "High Card", multiplier: 0 };
}

function teenPattiRound(input: Record<string, number>): ServerGameOutcome {
  const checked = checkedBets(input, ["0", "1", "2"], 10_000);
  const deck = secureShuffle(Array.from({ length: 52 }, (_, index) => index));
  const hands = [deck.slice(0, 3), deck.slice(3, 6), deck.slice(6, 9)].map((cards) => {
    const value = teenPattiValue(cards);
    return {
      cards: cards.map((card) => ({ rank: card % 13 + 2, suit: Math.floor(card / 13) })),
      ...value,
    };
  });
  const payout = hands.reduce((sum, hand, lane) => sum + checked.bets[String(lane)] * hand.multiplier, 0);
  return { outcome: { hands }, wager: checked.total, payout };
}

function luck77Round(input: Record<string, number>): ServerGameOutcome {
  const checked = checkedBets(input, ["watermelon", "seven", "plum"], 500);
  if (Object.values(checked.bets).filter((amount) => amount > 0).length > 2) {
    throw new Error("Choose no more than two Luck77 houses.");
  }
  const segments = ["seven", "watermelon", "plum", "watermelon", "plum", "watermelon", "seven", "plum", "watermelon", "plum", "watermelon", "plum"];
  const winner = segments[randomInt(segments.length)];
  const multiplier = winner === "seven" ? 8 : 2;
  return { outcome: { winner, multiplier }, wager: checked.total, payout: checked.bets[winner] * multiplier };
}

function footballRound(input: Record<string, number>): ServerGameOutcome {
  const checked = checkedBets(input, footballMultipliers.map((_, index) => String(index)), 500);
  const weights = footballMultipliers.map((multiplier) => Math.round(100_000 / multiplier));
  const ticket = randomInt(weights.reduce((sum, weight) => sum + weight, 0));
  let cursor = 0;
  let winner = 0;
  for (let index = 0; index < weights.length; index++) {
    cursor += weights[index];
    if (ticket < cursor) { winner = index; break; }
  }
  const multiplier = footballMultipliers[winner];
  return { outcome: { winner, multiplier }, wager: checked.total, payout: checked.bets[String(winner)] * multiplier };
}

function jungleMultiplier(symbol: typeof jungleSymbols[number], matches: number) {
  const table = {
    ten: [0, 0, 0, 3, 10, 20], crocodile: [0, 0, 0, 5, 20, 40],
    rhino: [0, 0, 0, 8, 30, 60], elephant: [0, 0, 0, 10, 50, 100],
  } as const;
  return table[symbol][matches] ?? 0;
}

function jungleRound(input: Record<string, number>): ServerGameOutcome {
  const checked = checkedBets(input, ["spin"], 150, 3_000);
  if (checked.total === 0) throw new Error("Choose a spin amount.");
  if (checked.total % junglePaylines.length !== 0) throw new Error("The Jungle Hunt bet must cover all 15 lines.");
  const grid = Array.from({ length: 3 }, () => Array.from({ length: 5 }, () => jungleSymbols[randomInt(jungleSymbols.length)]));
  const winningLines: number[] = [];
  const lineBet = checked.total / junglePaylines.length;
  let payout = 0;
  for (let line = 0; line < junglePaylines.length; line++) {
    const path = junglePaylines[line];
    const first = grid[path[0]][0];
    let matches = 1;
    for (let column = 1; column < 5 && grid[path[column]][column] === first; column++) matches++;
    if (matches < 3) continue;
    winningLines.push(line + 1);
    payout += lineBet * jungleMultiplier(first, matches);
  }
  return { outcome: { grid, winningLines }, wager: checked.total, payout };
}

type WeightedGoldenOutcome = { label: string; multiplier: number; weight: number };

const goldenWheelOutcomes: Record<string, readonly WeightedGoldenOutcome[]> = {
  food_wheel: [
    { label: "Empty Plate", multiplier: 0, weight: 400 },
    { label: "Rice Bowl", multiplier: 1, weight: 300 },
    { label: "Ramen", multiplier: 1.5, weight: 150 },
    { label: "Sushi", multiplier: 2, weight: 90 },
    { label: "Feast", multiplier: 5, weight: 45 },
    { label: "Golden Wagyu", multiplier: 10, weight: 15 },
  ],
  cat_wheel: [
    { label: "Sleeping Cat", multiplier: 0, weight: 500 },
    { label: "Silver Coin", multiplier: 1, weight: 280 },
    { label: "Gold Coin", multiplier: 2, weight: 140 },
    { label: "Lucky Charm", multiplier: 5, weight: 60 },
    { label: "Maneki Neko Jackpot", multiplier: 20, weight: 20 },
  ],
  deep_sea: [
    { label: "Empty Net", multiplier: 0, weight: 450 },
    { label: "Small Fish", multiplier: 1.2, weight: 300 },
    { label: "Tuna", multiplier: 2, weight: 150 },
    { label: "Shark", multiplier: 4, weight: 70 },
    { label: "Golden Whale", multiplier: 15, weight: 30 },
  ],
};

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

function goldenSingleRound(game: string, input: Record<string, number>): ServerGameOutcome {
  const unit = game === "deep_sea" ? 200 : 100;
  const checked = checkedBets(input, ["play"], unit, 10_000);
  if (checked.total === 0) throw new Error("Choose a play amount.");
  if (game === "card_arena") {
    const player = randomInt(1, 14);
    const dealer = randomInt(1, 14);
    const multiplier = player > dealer ? 2 : player === dealer ? 1 : 0;
    const label = player > dealer ? "Win" : player === dealer ? "Push" : "Lose";
    return {
      outcome: { label, multiplier, player, dealer },
      wager: checked.total,
      payout: checked.total * multiplier,
    };
  }
  const selected = chooseWeighted(goldenWheelOutcomes[game]);
  return {
    outcome: { label: selected.label, multiplier: selected.multiplier },
    wager: checked.total,
    payout: Math.floor(checked.total * selected.multiplier),
  };
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

function threeCardRound(input: Record<string, number>): ServerGameOutcome {
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
  let winner = 0;
  for (let index = 1; index < hands.length; index++) {
    if (hands[index].class > hands[winner].class ||
        (hands[index].class === hands[winner].class && hands[index].score > hands[winner].score)) winner = index;
  }
  return {
    outcome: { hands, winningSeat: winner + 1, multiplier: 3, label: `Seat ${winner + 1}` },
    wager: checked.total,
    payout: checked.bets[String(winner)] * 3,
  };
}

function greedyRound(game: string, input: Record<string, number>): ServerGameOutcome {
  const keys = Array.from({ length: 8 }, (_, index) => String(index));
  const lion = game === "greedy_lion";
  const checked = checkedBets(input, keys, lion ? 500 : 100, lion ? 50_000_000 : 100_000);
  if (checked.total === 0) throw new Error(lion ? "Choose at least one food house." : "Choose at least one wheel zone.");
  if (Object.values(checked.bets).filter((amount) => amount > 0).length > 6) {
    throw new Error("Choose no more than six wheel zones.");
  }
  const multipliers = lion
    ? [5, 45, 25, 5, 15, 5, 5, 10] as const
    : [5, 5, 5, 5, 10, 15, 25, 45] as const;
  const labels = lion
    ? ["Strawberry", "Chicken", "Octopus", "Corn", "Fish", "Lettuce", "Grapes", "Steak"] as const
    : ["Berry", "Lemon", "Grape", "Cake", "Fish", "Honey", "Lobster", "Royal Feast"] as const;
  const winner = chooseWeighted(multipliers.map((multiplier, index) => ({
    index,
    // Keep selection server-controlled and roughly inverse to the published
    // multiplier instead of trusting any client-provided result.
    weight: Math.max(1, Math.round(100 / multiplier)),
  }))).index;
  const multiplier = multipliers[winner];
  return {
    outcome: { winner, winningZone: winner + 1, multiplier, label: labels[winner] },
    wager: checked.total,
    payout: checked.bets[String(winner)] * multiplier,
  };
}

function createServerGameOutcome(game: string, bets: Record<string, number>) {
  if (game === teenPattiGame) return teenPattiRound(bets);
  if (game === "luck77") return luck77Round(bets);
  if (game === "bounty_football") return footballRound(bets);
  if (game === "jungle_hunt") return jungleRound(bets);
  if (goldenSingleGames.has(game)) return goldenSingleRound(game, bets);
  if (game === "three_card") return threeCardRound(bets);
  if (goldenZoneGames.has(game)) return greedyRound(game, bets);
  throw new Error("This game is unavailable.");
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

    const result = createServerGameOutcome(input.game, bets);
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
        [randomUUID(), code("GMC"), `GAME_ROUND:${identity.userId}:${input.clientRoundId}:CREDIT`, identity.userId, result.payout, `${input.game} round payout`, JSON.stringify({ game: input.game, clientRoundId: input.clientRoundId })],
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
    return gameRoundResponse({
      id, client_round_id: input.clientRoundId, game_name: input.game, bets_json: bets,
      outcome_json: result.outcome, wager_total: result.wager, payout_total: result.payout,
      balance_after: after, created_at: now,
    } as RowDataPacket);
  });
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

async function ensureWallet(connection: PoolConnection, ownerId: string, assetType: "COIN" | "DIAMOND") {
  await connection.execute("INSERT IGNORE INTO wallet_balances (id, owner_type, owner_id, asset_type) VALUES (?, 'APPLICATION_USER', ?, ?)", [randomUUID(), ownerId, assetType]);
}
