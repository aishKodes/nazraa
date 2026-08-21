import "server-only";

import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { publicImageFromDataUrl } from "@/lib/security/public-images";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { permissionsForMobileRole } from "@/lib/auth/mobile-session";
import { encryptPrivateText } from "@/lib/security/documents";
import { mobileCompletionSnapshot } from "@/lib/db/repositories/mobile-completion";
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

function levelProgress(totalPoints: number, track: "consumption" | "anchorIncome", maximumLevel = 120) {
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
  if (role === "ADMIN") return "admin";
  if (role === "SUPER_ADMIN") return "super_admin";
  if (role === "MASTER") return "master";
  return isHost ? "host" : "user";
}

async function settingsMap() {
  const [rows] = await db().query<(RowDataPacket & { setting_key: string; setting_value: unknown })[]>(
    "SELECT setting_key, setting_value FROM system_settings",
  );
  return Object.fromEntries(rows.map((row) => [row.setting_key, asObject(row.setting_value)]));
}

export async function mobileBootstrap(identity: MobileIdentity) {
  const [
    profileRows,
    walletRows,
    transactionRows,
    roomRows,
    roomMemberRows,
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
      `SELECT id, transaction_code, asset_type, transaction_type, source_id, destination_id, amount, reason, created_at
       FROM ledger_transactions WHERE source_id = ? OR destination_id = ? ORDER BY created_at DESC LIMIT 100`,
      [identity.userId, identity.userId],
    ),
    db().query<RowDataPacket[]>(
      `SELECT room.id, room.room_code, room.room_type, room.title, room.category, room.language_code,
              room.privacy, room.seat_count, room.theme_index, room.room_photo_asset_id, room.country_code,
              room.password_hash, room.chat_locked, room.interactions_enabled, room.theme_enabled, room.pk_requests_enabled,
              top_user.public_id top_public_id, top_user.full_name top_name, top_user.avatar_url top_avatar_url,
              top_user.country_code top_country, top_user.language_code top_language,
              top_user.level_number top_level, top_user.vip_tier top_vip,
              room.status, room.audience_count,
              user.public_id host_public_id, user.full_name host_name, user.level_number host_level,
              user.vip_tier host_vip, user.avatar_url host_avatar_url, user.country_code host_country,
              user.language_code host_language,
              (SELECT operator.role FROM platform_accounts operator
               WHERE operator.status = 'ACTIVE' AND
                 (operator.application_user_id = user.id OR operator.application_user_id = user.external_user_id
                  OR operator.application_user_id = CAST(user.public_id AS CHAR))
               ORDER BY operator.created_at LIMIT 1) host_platform_role,
              account.public_id agency_public_id, account.full_name agency_name
       FROM live_rooms room INNER JOIN application_users user ON user.id = room.host_application_user_id
       LEFT JOIN application_users top_user ON top_user.id = room.top_application_user_id
       LEFT JOIN platform_accounts account ON account.id = room.agency_account_id
       WHERE room.status IN ('ACTIVE','LOCKED') ORDER BY room.started_at DESC LIMIT 100`,
    ),
    db().query<RowDataPacket[]>(
      `SELECT room.room_code, member.room_role, user.public_id, user.full_name, user.avatar_url
       FROM live_room_members member INNER JOIN live_rooms room ON room.id = member.room_id
       INNER JOIN application_users user ON user.id = member.application_user_id
       WHERE room.status IN ('ACTIVE','LOCKED') AND member.left_at IS NULL AND member.room_role IN ('OWNER','ADMIN')
       ORDER BY room.room_code, member.room_role = 'OWNER' DESC, member.updated_at`,
    ),
    db().query<RowDataPacket[]>(
      `SELECT user.public_id, user.full_name, user.avatar_url, user.country_code, user.language_code,
              user.level_number, user.vip_tier, user.is_host,
              account.role platform_role
       FROM application_users user
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
      `SELECT id, title, message, action_target, COALESCE(published_at, scheduled_at, created_at) created_at
       FROM platform_notifications WHERE (status = 'PUBLISHED' OR (status = 'SCHEDULED' AND scheduled_at <= CURRENT_TIMESTAMP(3)))
       AND (audience_role IS NULL OR audience_role IN (?, 'ALL')) ORDER BY created_at DESC LIMIT 40`,
      [identity.role],
    ),
    db().query<RowDataPacket[]>(
      "SELECT id, notification_type, title, message, action_target, read_at, created_at FROM mobile_notifications WHERE application_user_id = ? ORDER BY created_at DESC LIMIT 60",
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
              owner.public_id owner_public_id,
              COUNT(host.id) host_count, COALESCE(SUM(host.live_minutes_30d), 0) total_live_minutes,
              COALESCE(SUM(host.gifts_value_30d), 0) estimated_earnings
       FROM application_users user INNER JOIN platform_accounts account ON account.id = user.agency_account_id
       LEFT JOIN application_users owner
         ON owner.id = account.application_user_id
         OR owner.external_user_id = account.application_user_id
         OR CAST(owner.public_id AS CHAR) = account.application_user_id
       LEFT JOIN host_profiles host ON host.agency_account_id = account.id
       WHERE user.id = ? GROUP BY account.id, account.public_id, account.full_name, account.status, account.country_code, owner.public_id LIMIT 1`,
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
  const maximumLevel = Number(levelConfig.maximumLevel ?? 120);
  const commerce = settings["mobile.commerce"] ?? {};

  const usersByName = new Map<string, { id: string; name: string; level: number; vip: number }>();
  for (const item of peopleRows[0]) usersByName.set(String(item.public_id), { id: String(item.public_id), name: String(item.full_name), level: Number(item.level_number), vip: Number(item.vip_tier) });

  const roomManagers = new Map<string, RowDataPacket[]>();
  for (const member of roomMemberRows[0]) {
    const roomCode = String(member.room_code);
    roomManagers.set(roomCode, [...(roomManagers.get(roomCode) ?? []), member]);
  }
  const rooms = roomRows[0].map((row, index) => ({
    id: String(row.room_code), title: String(row.title), category: String(row.category),
    language: String(row.language_code), listeners: Number(row.audience_count), themeIndex: Number(row.theme_index ?? index % 6), privacy: String(row.privacy).toLowerCase(),
    seatCount: Number(row.seat_count), kind: row.room_type === "PARTY" ? "party" : row.room_type === "FACE" ? "face" : "live", isActive: true,
    photoUrl: row.room_photo_asset_id == null ? null : `https://nazraa.vercel.app/api/v1/assets/rooms/${row.room_photo_asset_id}`,
    passwordRequired: row.password_hash != null,
    chatLocked: Boolean(row.chat_locked), interactionsEnabled: Boolean(row.interactions_enabled),
    themeEnabled: Boolean(row.theme_enabled),
    pkRequestsEnabled: Boolean(row.pk_requests_enabled),
    countryCode: row.country_code,
    agencyId: row.agency_public_id == null ? null : String(row.agency_public_id), agencyName: row.agency_name,
    host: { id: String(row.host_public_id), name: String(row.host_name), avatarUrl: row.host_avatar_url,
      country: row.host_country ?? "", language: row.host_language ?? "", level: Number(row.host_level),
      vip: Number(row.host_vip), role: productRole(row.host_platform_role, true) },
    topUser: row.top_public_id == null ? null : {
      id: String(row.top_public_id), name: String(row.top_name), avatarUrl: row.top_avatar_url,
      country: row.top_country ?? "", language: row.top_language ?? "", level: Number(row.top_level),
      vip: Number(row.top_vip), role: "user",
    },
    managers: (roomManagers.get(String(row.room_code)) ?? []).map((member) => ({ id: String(member.public_id), name: String(member.full_name), avatarUrl: member.avatar_url, roomRole: String(member.room_role).toLowerCase() })),
  }));

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
      whatsappE164: profile.whatsapp_e164, level: Number(profile.level_number),
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
    wallet: { coins, diamonds, reservedDiamonds, gameCredits: 0 },
    transactions: transactionRows[0].map((row) => ({
      id: String(row.transaction_code), title: String(row.reason || row.transaction_type), amount: Number(row.amount),
      createdAt: row.created_at, currency: String(row.asset_type), isCredit: row.destination_id === identity.userId,
      ledger: row.asset_type === "DIAMOND" ? "hostEarnings" : "socialCoins", type: String(row.transaction_type),
    })),
    rooms,
    people: peopleRows[0].map((row) => ({ id: String(row.public_id), name: String(row.full_name), avatarUrl: row.avatar_url,
      country: row.country_code ?? "", language: row.language_code ?? "", level: Number(row.level_number),
      vip: Number(row.vip_tier), role: productRole(row.platform_role, row.is_host) })),
    gifts: giftRows[0].map((row, index) => ({ id: String(row.gift_key), name: String(row.name), symbol: row.emoji ? String(row.emoji) : giftSymbol(String(row.gift_key), String(row.name)), cost: Number(row.coin_price), category: String(row.category), accent: [0xffff4fa2, 0xff9a5cff, 0xffffc857, 0xff4cc9f0][index % 4], visualUrl: row.visual_url, animationKey: row.animation_key })),
    banners: bannerRows[0].map((row) => ({ id: String(row.id), image: String(row.image_url), title: row.title, subtitle: row.subtitle, actionType: String(row.action_type).toLowerCase(), actionTarget: row.action_target, placement: String(row.placement).toLowerCase(), priority: Number(row.priority), startAt: row.starts_at ?? new Date(0).toISOString(), endAt: row.ends_at ?? "2999-12-31T23:59:59.000Z", isActive: true })),
    announcements: [...platformNotificationRows[0], ...mobileNotificationRows[0]].map((row, index) => ({ id: String(row.id), message: String(row.message), title: row.title, kind: row.notification_type ? "system" : "event", actionTarget: row.action_target, priority: 100 - index, startAt: row.created_at, endAt: "2999-12-31T23:59:59.000Z", isActive: true })),
    coinPackages: packageRows[0].map((row) => ({ id: String(row.public_id), name: String(row.name), badge: row.badge_label, coins: Number(row.coin_amount), bonusCoins: 0, pricePaise: Math.round(Number(row.display_price ?? 0) * 100), popular: row.badge_label === "Popular" })),
    coinSellers: sellerRows[0].map((row) => ({ id: String(row.public_id), name: String(row.full_name), whatsappE164: String(row.business_whatsapp_e164), supportUri: `https://wa.me/${String(row.business_whatsapp_e164).replace(/\D/g, "")}`, availability: row.availability_status === "AVAILABLE" ? "available" : "offline", fulfilledOrders: Number(row.fulfilled_orders), rating: 5, supportedRegion: row.supported_region ?? row.country_code ?? "", verified: row.verification_status === "VERIFIED" })),
    coinPurchaseRequests: orderRows[0].map((row) => ({ id: String(row.public_id), userId: identity.publicId, packageId: String(row.package_public_id), sellerId: String(row.seller_public_id), coins: Number(row.coin_amount), pricePaise: Math.round(Number(row.display_price ?? 0) * 100), status: String(row.status).toLowerCase(), createdAt: row.created_at })),
    payoutMethods: payoutRows[0].map((row) => ({ id: String(row.id), type: row.method_type === "UPI" ? "upi" : "bankTransfer", displayName: String(row.display_name), maskedDestination: String(row.masked_destination), verified: Boolean(row.verified) })),
    withdrawalRequests: withdrawalRows[0].map((row) => ({ id: String(row.withdrawal_code), userId: identity.publicId, payoutMethodId: String(row.payout_method_id ?? ""), amount: Number(row.amount), status: String(row.status).toLowerCase(), createdAt: row.requested_at, reviewNote: row.review_reason })),
    minimumWithdrawal: Number(commerce.minimumWithdrawal ?? 1000),
    followedUserIds: followUserRows[0].map((row) => String(row.public_id)),
    followedAgencyIds: followAgencyRows[0].map((row) => String(row.public_id)),
    faceVerificationStatus: String(profile.face_verification_status).toLowerCase(),
    agency: currentAgency ? { id: String(currentAgency.public_id), code: String(currentAgency.public_id), name: String(currentAgency.full_name), country: currentAgency.country_code ?? "", ownerUserId: currentAgency.owner_public_id == null ? "0" : String(currentAgency.owner_public_id), status: String(currentAgency.status), hosts: [], targetProgress: 0, estimatedEarnings: Number(currentAgency.estimated_earnings), totalLiveMinutes: Number(currentAgency.total_live_minutes), hostCount: Number(currentAgency.host_count) } : null,
    hostProfile: currentHost ? { id: String(currentHost.id), status: String(currentHost.status).toLowerCase(), agencyName: currentHost.agency_name ?? "Independent", level: levelProgress(Number(currentHost.anchor_income_points), "anchorIncome", maximumLevel).level, liveMinutes: Number(currentHost.live_minutes_30d), validDays: Number(currentHost.sessions_30d), requiredDays: 15, targetProgress: Math.min(1, Number(currentHost.live_minutes_30d) / 1800), giftEarnings: Number(currentHost.gifts_value_30d), diamonds } : null,
    consumptionLevel: levelProgress(Number(profile.consumption_points), "consumption", maximumLevel),
    anchorIncomeLevel: levelProgress(Number(profile.anchor_income_points), "anchorIncome", maximumLevel),
    rankings: rankingRows[0].map((row, index) => ({ rank: index + 1, user: { id: String(row.public_id), name: String(row.full_name), level: Number(row.level_number), vip: Number(row.vip_tier), role: "user" }, score: Number(row.consumption_points), label: "Consumption" })),
    agencyRankings: agencyRankingRows[0].map((row, index) => ({ rank: index + 1, agency: { id: String(row.public_id), code: String(row.public_id), name: String(row.full_name), country: "", ownerUserId: "0", status: "ACTIVE", hosts: [], targetProgress: 0, estimatedEarnings: Number(row.score), totalLiveMinutes: 0 }, score: Number(row.score), label: "Agency" })),
    posts: [],
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

export async function createWithdrawalRequest(identity: MobileIdentity, amount: number, payoutMethodId: string) {
  const settings = await settingsMap();
  const minimum = Number(settings["mobile.commerce"]?.minimumWithdrawal ?? 1000);
  if (!Number.isSafeInteger(amount) || amount < minimum) throw new Error(`Minimum withdrawal is ${minimum}.`);
  return withTransaction(async (connection) => {
    const [hostRows] = await connection.query<RowDataPacket[]>("SELECT id FROM host_profiles WHERE application_user_id = ? AND status = 'ACTIVE' LIMIT 1", [identity.userId]);
    if (!hostRows[0]) throw new Error("Only an active host can request a withdrawal.");
    const [methodRows] = await connection.query<(RowDataPacket & { id: string; masked_destination: string })[]>("SELECT id, masked_destination FROM payout_methods WHERE id = ? AND application_user_id = ? AND active = TRUE AND verified = TRUE LIMIT 1", [payoutMethodId, identity.userId]);
    if (!methodRows[0]) throw new Error("Choose a verified payout method.");
    await connection.execute("INSERT IGNORE INTO wallet_balances (id, owner_type, owner_id, asset_type) VALUES (?, 'APPLICATION_USER', ?, 'DIAMOND')", [randomUUID(), identity.userId]);
    const [walletRows] = await connection.query<(RowDataPacket & { id: string; available_balance: number; reserved_balance: number })[]>("SELECT id, available_balance, reserved_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'DIAMOND' FOR UPDATE", [identity.userId]);
    const wallet = walletRows[0];
    if (!wallet || Number(wallet.available_balance) < amount) throw new Error("Available host earnings are too low for this request.");
    await connection.execute("UPDATE wallet_balances SET available_balance = available_balance - ?, reserved_balance = reserved_balance + ? WHERE id = ?", [amount, amount, wallet.id]);
    const requestId = randomUUID(); const requestCode = code("WDR");
    await connection.execute(
      `INSERT INTO withdrawal_requests (id, withdrawal_code, application_user_id, agency_account_id, amount, payout_method_masked, payout_method_id)
       SELECT ?, ?, id, agency_account_id, ?, ?, ? FROM application_users WHERE id = ?`,
      [requestId, requestCode, amount, methodRows[0].masked_destination, payoutMethodId, identity.userId],
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
  const photo = input.photoDataUrl ? publicImageFromDataUrl(input.photoDataUrl, 1536 * 1024, "Room photo") : null;
  const photoAssetId = photo ? randomUUID() : null;
  if (input.privacy === "locked" && !/^(\d{4}|\d{6}|\d{10})$/.test(input.password ?? "")) {
    throw new Error("Locked rooms require a 4, 6, or 10 digit password.");
  }
  const passwordHash = input.privacy === "locked" ? await bcrypt.hash(input.password!, 10) : null;
  await withTransaction(async (connection) => {
    const [userRows] = await connection.query<(RowDataPacket & { agency_account_id: string | null })[]>("SELECT agency_account_id FROM application_users WHERE id = ? LIMIT 1 FOR UPDATE", [identity.userId]);
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

export async function sendGift(identity: MobileIdentity, input: { giftId: string; recipient: string; quantity: number }) {
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 99) throw new Error("Choose a valid gift quantity.");
  return withTransaction(async (connection) => {
    const [giftRows] = await connection.query<(RowDataPacket & { name: string; coin_price: number })[]>("SELECT name, coin_price FROM gift_catalog WHERE gift_key = ? AND active = TRUE LIMIT 1", [input.giftId]);
    const [recipientRows] = await connection.query<(RowDataPacket & { id: string; full_name: string })[]>("SELECT id, full_name FROM application_users WHERE (public_id = ? OR full_name = ?) AND account_status = 'ACTIVE' ORDER BY public_id LIMIT 1", [input.recipient, input.recipient]);
    const gift = giftRows[0]; const recipient = recipientRows[0];
    if (!gift || !recipient) throw new Error("The gift or recipient is unavailable.");
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
    await connection.execute("UPDATE application_users SET consumption_points = consumption_points + ? WHERE id = ?", [total, identity.userId]);
    await connection.execute("UPDATE application_users SET anchor_income_points = anchor_income_points + ? WHERE id = ?", [total, recipient.id]);
    return { success: true, remainingCoins: Number(senderRows[0].available_balance) - total, message: `Sent to ${recipient.full_name}` };
  });
}

async function ensureWallet(connection: PoolConnection, ownerId: string, assetType: "COIN" | "DIAMOND") {
  await connection.execute("INSERT IGNORE INTO wallet_balances (id, owner_type, owner_id, asset_type) VALUES (?, 'APPLICATION_USER', ?, ?)", [randomUUID(), ownerId, assetType]);
}
