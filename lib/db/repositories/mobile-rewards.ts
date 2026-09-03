import "server-only";

import { randomUUID } from "crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";

function transactionCode(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

async function ensureCoinWallet(connection: PoolConnection, userId: string) {
  await connection.execute(
    "INSERT IGNORE INTO wallet_balances (id, owner_type, owner_id, asset_type) VALUES (?, 'APPLICATION_USER', ?, 'COIN')",
    [randomUUID(), userId],
  );
}

function avatarUrl(row: RowDataPacket, prefix = "") {
  const publicId = row[`${prefix}public_id`];
  const uploadedAt = row[`${prefix}avatar_updated_at`];
  if (publicId != null && uploadedAt != null) {
    return `https://nazraa.vercel.app/api/v1/mobile/avatar/${publicId}?v=${new Date(uploadedAt as string | Date).getTime()}`;
  }
  return row[`${prefix}avatar_url`] ?? null;
}

export async function vipSnapshot(identity: MobileIdentity) {
  await db().execute(
    "UPDATE application_users SET vip_tier = 0, vip_expires_at = NULL WHERE id = ? AND vip_tier > 0 AND vip_expires_at <= CURRENT_TIMESTAMP(3)",
    [identity.userId],
  );
  const [tiers, currentRows, claimRows, clockRows] = await Promise.all([
    db().query<RowDataPacket[]>(
      "SELECT tier, tier_key, name, price_coins, daily_reward_coins, validity_days, frame_asset, entry_asset, perks FROM vip_tiers WHERE active = TRUE ORDER BY tier",
    ),
    db().query<RowDataPacket[]>("SELECT vip_tier, vip_expires_at FROM application_users WHERE id = ? LIMIT 1", [identity.userId]),
    db().query<RowDataPacket[]>(
      "SELECT DATE_FORMAT(claim_date, '%Y-%m-%d') claim_date, reward_coins, claimed_at FROM vip_daily_claims WHERE application_user_id = ? ORDER BY claim_date DESC LIMIT 31",
      [identity.userId],
    ),
    db().query<(RowDataPacket & { today: string })[]>("SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d') today"),
  ]);
  const currentTier = Number(currentRows[0][0]?.vip_tier ?? 0);
  const today = String(clockRows[0][0]?.today ?? "").slice(0, 10);
  const lastClaimDate = claimRows[0][0]?.claim_date == null ? null : String(claimRows[0][0].claim_date).slice(0, 10);
  const mappedTiers = tiers[0].map((row) => ({
    tier: Number(row.tier), key: String(row.tier_key), name: String(row.name),
    priceCoins: Number(row.price_coins), dailyRewardCoins: Number(row.daily_reward_coins),
    validityDays: Number(row.validity_days ?? 30),
    frameAsset: String(row.frame_asset), entryAsset: row.entry_asset == null ? null : String(row.entry_asset),
    perks: (typeof row.perks === "string" ? JSON.parse(row.perks) : row.perks) as string[],
  }));
  const currentPrice = mappedTiers.find((tier) => tier.tier === currentTier)?.priceCoins ?? 0;
  return {
    currentTier,
    tiers: mappedTiers.map((tier) => ({ ...tier, upgradeCost: Math.max(0, tier.priceCoins - currentPrice) })),
    claimable: currentTier > 0 && lastClaimDate !== today,
    serverDate: today,
    lastClaimDate,
    expiresAt: currentRows[0][0]?.vip_expires_at ?? null,
    history: claimRows[0].map((row) => ({
      date: String(row.claim_date).slice(0, 10), rewardCoins: Number(row.reward_coins), claimedAt: row.claimed_at,
    })),
  };
}

export async function purchaseVipTier(identity: MobileIdentity, targetTier: number) {
  return withTransaction(async (connection) => {
    await connection.execute(
      "UPDATE application_users SET vip_tier = 0, vip_expires_at = NULL WHERE id = ? AND vip_tier > 0 AND vip_expires_at <= CURRENT_TIMESTAMP(3)",
      [identity.userId],
    );
    const [users] = await connection.query<(RowDataPacket & { vip_tier: number; vip_expires_at: Date | null })[]>(
      "SELECT vip_tier, vip_expires_at FROM application_users WHERE id = ? AND account_status = 'ACTIVE' LIMIT 1 FOR UPDATE",
      [identity.userId],
    );
    const currentTier = Number(users[0]?.vip_tier ?? 0);
    if (!users[0]) throw new Error("Your Nazraa account is unavailable.");
    if (targetTier <= currentTier) throw new Error("Choose a higher VIP tier.");
    const [tiers] = await connection.query<(RowDataPacket & { tier: number; name: string; price_coins: number; validity_days: number })[]>(
      "SELECT tier, name, price_coins, validity_days FROM vip_tiers WHERE active = TRUE AND tier IN (?, ?) ORDER BY tier FOR UPDATE",
      [currentTier || targetTier, targetTier],
    );
    const target = tiers.find((row) => Number(row.tier) === targetTier);
    if (!target) throw new Error("That VIP tier is unavailable.");
    const currentPrice = currentTier === 0 ? 0 : Number(tiers.find((row) => Number(row.tier) === currentTier)?.price_coins ?? 0);
    const price = Number(target.price_coins) - currentPrice;
    if (price <= 0) throw new Error("That VIP upgrade is unavailable.");
    await ensureCoinWallet(connection, identity.userId);
    const [wallets] = await connection.query<(RowDataPacket & { id: string; available_balance: number })[]>(
      "SELECT id, available_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' LIMIT 1 FOR UPDATE",
      [identity.userId],
    );
    const wallet = wallets[0];
    if (!wallet || Number(wallet.available_balance) < price) throw new Error("Not enough Coins for this VIP upgrade.");
    const ledgerId = randomUUID();
    const code = transactionCode("VIP");
    await connection.execute("UPDATE wallet_balances SET available_balance = available_balance - ? WHERE id = ?", [price, wallet.id]);
    await connection.execute(
      `INSERT INTO ledger_transactions
        (id, transaction_code, asset_type, transaction_type, source_type, source_id, destination_type, amount, status, reason)
       VALUES (?, ?, 'COIN', 'VIP_PURCHASE', 'APPLICATION_USER', ?, 'SYSTEM', ?, 'COMPLETED', ?)`,
      [ledgerId, code, identity.userId, price, `${target.name} VIP upgrade`],
    );
    const validityDays = Math.max(1, Number(target.validity_days ?? 30));
    const [expiryRows] = await connection.query<(RowDataPacket & { expires_at: Date })[]>(
      "SELECT DATE_ADD(GREATEST(CURRENT_TIMESTAMP(3), COALESCE(?, CURRENT_TIMESTAMP(3))), INTERVAL ? DAY) expires_at",
      [users[0]?.vip_expires_at ?? null, validityDays],
    );
    const expiresAt = expiryRows[0].expires_at;
    await connection.execute("UPDATE application_users SET vip_tier = ?, vip_expires_at = ? WHERE id = ?", [targetTier, expiresAt, identity.userId]);
    await connection.execute(
      "INSERT INTO vip_purchases (id, application_user_id, from_tier, to_tier, price_coins, ledger_transaction_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [randomUUID(), identity.userId, currentTier, targetTier, price, ledgerId, expiresAt],
    );
    await connection.execute(
      "INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'VIP', 'VIP upgraded', ?, 'vip')",
      [randomUUID(), identity.userId, `${target.name} VIP is now active.`],
    );
    return { tier: targetTier, name: target.name, chargedCoins: price, validityDays, expiresAt, newBalance: Number(wallet.available_balance) - price };
  });
}

export async function claimVipDailyReward(identity: MobileIdentity) {
  return withTransaction(async (connection) => {
    const [users] = await connection.query<(RowDataPacket & { vip_tier: number; vip_expires_at: Date | null })[]>(
      "SELECT vip_tier, vip_expires_at FROM application_users WHERE id = ? AND account_status = 'ACTIVE' LIMIT 1 FOR UPDATE",
      [identity.userId],
    );
    const tierNumber = Number(users[0]?.vip_tier ?? 0);
    if (tierNumber < 1) throw new Error("Activate VIP before claiming a VIP reward.");
    if (!users[0]?.vip_expires_at || new Date(users[0].vip_expires_at).getTime() <= Date.now()) {
      await connection.execute("UPDATE application_users SET vip_tier = 0, vip_expires_at = NULL WHERE id = ?", [identity.userId]);
      throw new Error("Your VIP validity has ended. Activate VIP again to claim rewards.");
    }
    const [tiers] = await connection.query<(RowDataPacket & { name: string; daily_reward_coins: number })[]>(
      "SELECT name, daily_reward_coins FROM vip_tiers WHERE tier = ? AND active = TRUE LIMIT 1",
      [tierNumber],
    );
    const tier = tiers[0];
    if (!tier) throw new Error("Your VIP tier is temporarily unavailable.");
    const [existing] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM vip_daily_claims WHERE application_user_id = ? AND claim_date = CURRENT_DATE LIMIT 1 FOR UPDATE",
      [identity.userId],
    );
    if (existing.length) throw new Error("Today's VIP reward is already claimed.");
    await ensureCoinWallet(connection, identity.userId);
    const [wallets] = await connection.query<(RowDataPacket & { id: string; available_balance: number })[]>(
      "SELECT id, available_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' LIMIT 1 FOR UPDATE",
      [identity.userId],
    );
    const wallet = wallets[0];
    const reward = Number(tier.daily_reward_coins);
    const [clock] = await connection.query<(RowDataPacket & { today: string })[]>(
      "SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d') today",
    );
    const serverDate = String(clock[0].today);
    const ledgerId = randomUUID();
    const code = transactionCode("VIPDAY");
    await connection.execute("UPDATE wallet_balances SET available_balance = available_balance + ? WHERE id = ?", [reward, wallet.id]);
    await connection.execute(
      `INSERT INTO ledger_transactions
        (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, destination_type, destination_id, amount, status, reason)
       VALUES (?, ?, ?, 'COIN', 'VIP_DAILY_REWARD', 'SYSTEM', 'APPLICATION_USER', ?, ?, 'COMPLETED', ?)`,
      [ledgerId, code, `vip-daily:${identity.userId}:${serverDate}`, identity.userId, reward, `${tier.name} VIP daily reward`],
    );
    await connection.execute(
      "INSERT INTO vip_daily_claims (id, application_user_id, claim_date, vip_tier, reward_coins, ledger_transaction_id) VALUES (?, ?, CURRENT_DATE, ?, ?, ?)",
      [randomUUID(), identity.userId, tierNumber, reward, ledgerId],
    );
    await connection.execute(
      "INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'VIP_REWARD', 'VIP reward claimed', ?, 'vip')",
      [randomUUID(), identity.userId, `${reward} coins added for ${tier.name} VIP.`],
    );
    return { tier: tierNumber, rewardCoins: reward, newBalance: Number(wallet.available_balance) + reward };
  });
}

type RocketTierRow = RowDataPacket & {
  level: number; name: string; target_coins: number; top1_reward_coins: number; top2_reward_coins: number;
  top3_reward_coins: number; room_reward_coins: number; duration_hours: number; animation_asset: string;
};

type RocketPolicy = {
  enabled: boolean;
  energyPerCoin: number;
  minimumUserLevel: number;
  minimumVipTier: number;
  vipEnergyBonusPercent: number;
};

async function rocketPolicy(connection: PoolConnection): Promise<RocketPolicy> {
  const [rows] = await connection.query<(RowDataPacket & { setting_value: unknown })[]>(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.room_features' LIMIT 1",
  );
  const raw = rows[0]?.setting_value;
  let value: Record<string, unknown> = {};
  try {
    value = typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown> : (raw ?? {}) as Record<string, unknown>;
  } catch {}
  return {
    enabled: value.rocketEnabled !== false,
    energyPerCoin: Math.min(100, Math.max(1, Math.floor(Number(value.rocketEnergyPerCoin ?? 1)))),
    minimumUserLevel: Math.min(120, Math.max(1, Math.floor(Number(value.rocketMinimumUserLevel ?? 1)))),
    minimumVipTier: Math.min(5, Math.max(0, Math.floor(Number(value.rocketMinimumVipTier ?? 0)))),
    vipEnergyBonusPercent: Math.min(500, Math.max(0, Math.floor(Number(value.rocketVipEnergyBonusPercent ?? 0)))),
  };
}

async function ensureRocketCycle(connection: PoolConnection, roomId: string) {
  await connection.execute(
    // Rocket cycle boundaries are persisted as UTC DATETIME values. Hostinger
    // may expose CURRENT_TIMESTAMP in its local server zone, so compare with
    // UTC_TIMESTAMP to avoid expiring a valid India-day cycle several hours early.
    "UPDATE rocket_cycles SET status = 'EXPIRED' WHERE room_id = ? AND status = 'ACTIVE' AND ends_at <= UTC_TIMESTAMP(3)",
    [roomId],
  );
  const [active] = await connection.query<(RowDataPacket & { id: string; rocket_level: number; target_coins: number; contributed_coins: number; ends_at: Date })[]>(
    "SELECT id, rocket_level, target_coins, contributed_coins, ends_at FROM rocket_cycles WHERE room_id = ? AND status = 'ACTIVE' ORDER BY starts_at DESC LIMIT 1 FOR UPDATE",
    [roomId],
  );
  if (active[0]) return active[0];
  const [lastRows] = await connection.query<(RowDataPacket & { rocket_level: number; status: string })[]>(
    "SELECT rocket_level, status FROM rocket_cycles WHERE room_id = ? ORDER BY starts_at DESC LIMIT 1",
    [roomId],
  );
  const [maximumRows] = await connection.query<(RowDataPacket & { maximum: number })[]>("SELECT MAX(level) maximum FROM rocket_tiers WHERE active = TRUE");
  const maximum = Math.max(1, Number(maximumRows[0]?.maximum ?? 1));
  const last = lastRows[0];
  const level = last?.status === "COMPLETED" ? (Number(last.rocket_level) >= maximum ? 1 : Number(last.rocket_level) + 1) : Number(last?.rocket_level ?? 1);
  const [tiers] = await connection.query<RocketTierRow[]>("SELECT * FROM rocket_tiers WHERE level = ? AND active = TRUE LIMIT 1", [level]);
  const tier = tiers[0];
  if (!tier) throw new Error("Rocket is temporarily unavailable.");
  const id = randomUUID();
  await connection.execute(
    `INSERT INTO rocket_cycles (id, room_id, rocket_level, target_coins, ends_at)
     VALUES (?, ?, ?, ?, DATE_SUB(DATE_ADD(DATE(DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 330 MINUTE)), INTERVAL 1 DAY), INTERVAL 330 MINUTE))`,
    [id, roomId, level, tier.target_coins],
  );
  const now = new Date();
  const indiaMinutes = now.getUTCHours() * 60 + now.getUTCMinutes() + 330;
  const minutesUntilReset = 1440 - (indiaMinutes % 1440);
  return { id, rocket_level: level, target_coins: Number(tier.target_coins), contributed_coins: 0, ends_at: new Date(now.getTime() + minutesUntilReset * 60000) };
}

async function creditReward(
  connection: PoolConnection,
  cycleId: string,
  userId: string,
  rewardGroup: "TOP1" | "TOP2" | "TOP3" | "IN_ROOM",
  rank: number | null,
  amount: number,
) {
  if (amount <= 0) return;
  await ensureCoinWallet(connection, userId);
  const [wallets] = await connection.query<(RowDataPacket & { id: string })[]>(
    "SELECT id FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' LIMIT 1 FOR UPDATE",
    [userId],
  );
  const ledgerId = randomUUID();
  const code = transactionCode("RKT");
  await connection.execute("UPDATE wallet_balances SET available_balance = available_balance + ? WHERE id = ?", [amount, wallets[0].id]);
  await connection.execute(
    `INSERT INTO ledger_transactions
      (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, destination_type, destination_id, amount, status, reason)
     VALUES (?, ?, ?, 'COIN', 'ROCKET_REWARD', 'SYSTEM', 'APPLICATION_USER', ?, ?, 'COMPLETED', ?)`,
    [ledgerId, code, `rocket:${cycleId}:${userId}`, userId, amount, `Rocket ${rewardGroup} reward`],
  );
  await connection.execute(
    "INSERT INTO rocket_rewards (id, rocket_cycle_id, application_user_id, reward_group, rank_number, reward_coins, ledger_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [randomUUID(), cycleId, userId, rewardGroup, rank, amount, ledgerId],
  );
  await connection.execute(
    "INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'ROCKET_REWARD', 'Rocket reward', ?, 'rocket')",
    [randomUUID(), userId, `${amount} Rocket reward coins added.`],
  );
}

export async function recordRocketGift(connection: PoolConnection, input: {
  roomId: string; giftEventId: string; senderUserId: string; coinValue: number;
}) {
  const policy = await rocketPolicy(connection);
  if (!policy.enabled) return null;
  const [senderRows] = await connection.query<(RowDataPacket & { level_number: number; vip_tier: number })[]>(
    "SELECT level_number, vip_tier FROM application_users WHERE id = ? AND account_status = 'ACTIVE' LIMIT 1",
    [input.senderUserId],
  );
  const sender = senderRows[0];
  if (!sender || Number(sender.level_number) < policy.minimumUserLevel || Number(sender.vip_tier) < policy.minimumVipTier) return null;
  const vipBonus = Number(sender.vip_tier) > 0 ? policy.vipEnergyBonusPercent : 0;
  const energy = Math.max(1, Math.floor(input.coinValue * policy.energyPerCoin * (100 + vipBonus) / 100));
  const cycle = await ensureRocketCycle(connection, input.roomId);
  await connection.execute(
    "INSERT INTO rocket_contributions (id, rocket_cycle_id, gift_event_id, application_user_id, coin_value) VALUES (?, ?, ?, ?, ?)",
    [randomUUID(), cycle.id, input.giftEventId, input.senderUserId, energy],
  );
  await connection.execute("UPDATE rocket_cycles SET contributed_coins = contributed_coins + ? WHERE id = ?", [energy, cycle.id]);
  const contributed = Number(cycle.contributed_coins) + energy;
  if (contributed < Number(cycle.target_coins)) {
    return { launched: false, cycleId: cycle.id, level: Number(cycle.rocket_level), contributedCoins: contributed, targetCoins: Number(cycle.target_coins) };
  }
  const [completion] = await connection.execute<ResultSetHeader>(
    "UPDATE rocket_cycles SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND status = 'ACTIVE'",
    [cycle.id],
  );
  if (completion.affectedRows !== 1) return { launched: false, cycleId: cycle.id, level: Number(cycle.rocket_level), contributedCoins: contributed, targetCoins: Number(cycle.target_coins) };
  const [tiers] = await connection.query<RocketTierRow[]>("SELECT * FROM rocket_tiers WHERE level = ? LIMIT 1", [cycle.rocket_level]);
  const tier = tiers[0];
  const [ranking] = await connection.query<(RowDataPacket & { application_user_id: string; total: number })[]>(
    `SELECT application_user_id, SUM(coin_value) total FROM rocket_contributions
     WHERE rocket_cycle_id = ? GROUP BY application_user_id ORDER BY total DESC, MIN(created_at), application_user_id LIMIT 3`,
    [cycle.id],
  );
  const topIds = new Set(ranking.map((row) => row.application_user_id));
  const rankedRewards = [Number(tier.top1_reward_coins), Number(tier.top2_reward_coins), Number(tier.top3_reward_coins)];
  for (let index = 0; index < ranking.length; index += 1) {
    await creditReward(connection, cycle.id, ranking[index].application_user_id, `TOP${index + 1}` as "TOP1" | "TOP2" | "TOP3", index + 1, rankedRewards[index]);
  }
  const [members] = await connection.query<(RowDataPacket & { application_user_id: string })[]>(
    `SELECT application_user_id FROM live_room_members
     WHERE room_id = ? AND left_at IS NULL AND last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 2 MINUTE
     ORDER BY last_seen_at DESC LIMIT 50`,
    [input.roomId],
  );
  for (const member of members) {
    if (!topIds.has(member.application_user_id)) {
      await creditReward(connection, cycle.id, member.application_user_id, "IN_ROOM", null, Number(tier.room_reward_coins));
    }
  }
  return {
    launched: true, cycleId: cycle.id, level: Number(cycle.rocket_level),
    contributedCoins: contributed, targetCoins: Number(cycle.target_coins), animationAsset: String(tier.animation_asset),
  };
}

export async function rocketSnapshot(identity: MobileIdentity, roomCode: string) {
  return withTransaction(async (connection) => {
    const policy = await rocketPolicy(connection);
    if (!policy.enabled) throw new Error("Rocket is currently disabled by the Master Panel.");
    const [rooms] = await connection.query<(RowDataPacket & { id: string })[]>(
      `SELECT room.id FROM live_rooms room INNER JOIN live_room_members member
         ON member.room_id = room.id AND member.application_user_id = ? AND member.left_at IS NULL
       WHERE room.room_code = ? AND room.status IN ('ACTIVE','LOCKED') LIMIT 1 FOR UPDATE`,
      [identity.userId, roomCode],
    );
    const room = rooms[0];
    if (!room) throw new Error("Join this room to open Rocket.");
    const cycle = await ensureRocketCycle(connection, room.id);
    const [tiers, ranking, history, rewards] = await Promise.all([
      connection.query<RocketTierRow[]>("SELECT * FROM rocket_tiers WHERE active = TRUE ORDER BY level"),
      connection.query<RowDataPacket[]>(
        `SELECT user.public_id, user.full_name, user.avatar_url, avatar.updated_at avatar_updated_at,
                user.country_code, user.level_number, user.anchor_income_points, user.vip_tier, SUM(item.coin_value) total
         FROM rocket_contributions item INNER JOIN application_users user ON user.id = item.application_user_id
         LEFT JOIN application_user_avatars avatar ON avatar.application_user_id = user.id
         WHERE item.rocket_cycle_id = ?
         GROUP BY user.id, user.public_id, user.full_name, user.avatar_url, avatar.updated_at,
                  user.country_code, user.level_number, user.anchor_income_points, user.vip_tier
         ORDER BY total DESC, MIN(item.created_at), user.public_id LIMIT 20`,
        [cycle.id],
      ),
      connection.query<RowDataPacket[]>(
        `SELECT cycle.id, cycle.rocket_level, cycle.contributed_coins, cycle.target_coins, cycle.status,
                cycle.starts_at, cycle.completed_at
         FROM rocket_cycles cycle WHERE cycle.room_id = ? ORDER BY cycle.starts_at DESC LIMIT 12`,
        [room.id],
      ),
      connection.query<RowDataPacket[]>(
        `SELECT reward.reward_group, reward.rank_number, reward.reward_coins, reward.created_at, cycle.rocket_level
         FROM rocket_rewards reward INNER JOIN rocket_cycles cycle ON cycle.id = reward.rocket_cycle_id
         WHERE reward.application_user_id = ? AND cycle.room_id = ? ORDER BY reward.created_at DESC LIMIT 30`,
        [identity.userId, room.id],
      ),
    ]);
    const tier = tiers[0].find((item) => Number(item.level) === Number(cycle.rocket_level))!;
    return {
      cycle: {
        id: cycle.id, level: Number(cycle.rocket_level), name: String(tier.name),
        contributedCoins: Number(cycle.contributed_coins), targetCoins: Number(cycle.target_coins),
        progress: Math.min(1, Number(cycle.contributed_coins) / Number(cycle.target_coins)),
        endsAt: cycle.ends_at, animationAsset: String(tier.animation_asset),
      },
      tiers: tiers[0].map((item) => ({
        level: Number(item.level), name: String(item.name), targetCoins: Number(item.target_coins),
        top1RewardCoins: Number(item.top1_reward_coins), top2RewardCoins: Number(item.top2_reward_coins),
        top3RewardCoins: Number(item.top3_reward_coins), roomRewardCoins: Number(item.room_reward_coins),
        animationAsset: String(item.animation_asset),
      })),
      topContributors: ranking[0].map((row, index) => ({
        rank: index + 1,
        user: {
          id: String(row.public_id), name: String(row.full_name), avatarUrl: avatarUrl(row), country: row.country_code ?? "",
          level: Number(row.level_number), anchorLevel: Math.max(1, Math.min(200, Math.floor(Math.sqrt(Number(row.anchor_income_points ?? 0) / 10000)) + 1)),
          vip: Number(row.vip_tier), role: "user",
        },
        score: Number(row.total), label: "Rocket",
      })),
      history: history[0].map((row) => ({
        id: String(row.id), level: Number(row.rocket_level), contributedCoins: Number(row.contributed_coins),
        targetCoins: Number(row.target_coins), status: String(row.status).toLowerCase(),
        startedAt: row.starts_at, completedAt: row.completed_at,
      })),
      myRewards: rewards[0].map((row) => ({
        level: Number(row.rocket_level), group: String(row.reward_group).toLowerCase(), rank: row.rank_number == null ? null : Number(row.rank_number),
        rewardCoins: Number(row.reward_coins), createdAt: row.created_at,
      })),
      rules: `${policy.energyPerCoin} energy per gifted coin. Minimum User Level ${policy.minimumUserLevel}, minimum VIP ${policy.minimumVipTier}. VIP energy bonus ${policy.vipEnergyBonusPercent}%. Top three contributors and active room members receive configured rewards. Progress resets at 00:00 IST.`,
    };
  });
}

export async function pkStreakSnapshot(identity: MobileIdentity) {
  const [streaks, events] = await Promise.all([
    db().query<RowDataPacket[]>("SELECT current_streak, qualifying_wins_total, bonuses_awarded FROM pk_host_streaks WHERE application_user_id = ? LIMIT 1", [identity.userId]),
    db().query<RowDataPacket[]>(
      "SELECT result, received_coins, qualifying_win, streak_after, bonus_coins, created_at FROM pk_host_streak_events WHERE application_user_id = ? ORDER BY created_at DESC LIMIT 12",
      [identity.userId],
    ),
  ]);
  return {
    currentStreak: Number(streaks[0][0]?.current_streak ?? 0), requiredWins: 3, minimumBattleCoins: 5000, bonusCoins: 10000,
    qualifyingWinsTotal: Number(streaks[0][0]?.qualifying_wins_total ?? 0), bonusesAwarded: Number(streaks[0][0]?.bonuses_awarded ?? 0),
    history: events[0].map((row) => ({ result: String(row.result).toLowerCase(), receivedCoins: Number(row.received_coins), qualifyingWin: Boolean(row.qualifying_win), streakAfter: Number(row.streak_after), bonusCoins: Number(row.bonus_coins), createdAt: row.created_at })),
  };
}

async function applyPkHostResult(connection: PoolConnection, input: {
  sessionId: string; hostUserId: string; result: "WIN" | "LOSS" | "DRAW"; receivedCoins: number;
}) {
  const [existing] = await connection.query<RowDataPacket[]>(
    "SELECT streak_after, bonus_coins FROM pk_host_streak_events WHERE pk_session_id = ? AND application_user_id = ? LIMIT 1",
    [input.sessionId, input.hostUserId],
  );
  if (existing.length) return { streak: Number(existing[0].streak_after), bonusCoins: Number(existing[0].bonus_coins) };
  await connection.execute(
    "INSERT IGNORE INTO pk_host_streaks (application_user_id) VALUES (?)",
    [input.hostUserId],
  );
  const [streakRows] = await connection.query<(RowDataPacket & { current_streak: number })[]>(
    "SELECT current_streak FROM pk_host_streaks WHERE application_user_id = ? LIMIT 1 FOR UPDATE",
    [input.hostUserId],
  );
  const qualifying = input.result === "WIN" && input.receivedCoins >= 5000;
  let streak = qualifying ? Number(streakRows[0].current_streak) + 1 : 0;
  let bonus = 0;
  let ledgerId: string | null = null;
  if (streak >= 3) {
    bonus = 10000;
    streak = 0;
    await ensureCoinWallet(connection, input.hostUserId);
    const [wallets] = await connection.query<(RowDataPacket & { id: string })[]>(
      "SELECT id FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' LIMIT 1 FOR UPDATE",
      [input.hostUserId],
    );
    ledgerId = randomUUID();
    await connection.execute("UPDATE wallet_balances SET available_balance = available_balance + 10000 WHERE id = ?", [wallets[0].id]);
    await connection.execute(
      `INSERT INTO ledger_transactions
        (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, destination_type, destination_id, amount, status, reason)
       VALUES (?, ?, ?, 'COIN', 'PK_STREAK_REWARD', 'SYSTEM', 'APPLICATION_USER', ?, 10000, 'COMPLETED', 'Three qualifying PK wins')`,
      [ledgerId, transactionCode("PK3"), `pk-streak:${input.sessionId}:${input.hostUserId}`, input.hostUserId],
    );
    await connection.execute(
      "INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'PK_STREAK', 'Battle Royal complete', '10,000 coins added for three qualifying PK wins.', 'pk')",
      [randomUUID(), input.hostUserId],
    );
  }
  await connection.execute(
    `UPDATE pk_host_streaks SET current_streak = ?,
       qualifying_wins_total = qualifying_wins_total + ?, bonuses_awarded = bonuses_awarded + ?
     WHERE application_user_id = ?`,
    [streak, qualifying ? 1 : 0, bonus > 0 ? 1 : 0, input.hostUserId],
  );
  await connection.execute(
    `INSERT INTO pk_host_streak_events
      (id, pk_session_id, application_user_id, result, received_coins, qualifying_win, streak_after, bonus_coins, bonus_ledger_transaction_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), input.sessionId, input.hostUserId, input.result, input.receivedCoins, qualifying, streak, bonus, ledgerId],
  );
  return { streak, bonusCoins: bonus, qualifying };
}

export async function finalizePkSession(identity: MobileIdentity, input: { sessionId: string; completed: boolean }) {
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & {
      id: string; status: string; source_room_id: string; target_room_id: string; source_room_code: string; target_room_code: string; source_host_id: string; target_host_id: string; starts_at: Date; source_score: number; target_score: number; winner_room_id: string | null;
    })[]>(
      `SELECT session.id, session.status, session.source_room_id, session.target_room_id,
              session.source_score, session.target_score, session.winner_room_id,
              source.room_code source_room_code, target.room_code target_room_code,
              source.host_application_user_id source_host_id, target.host_application_user_id target_host_id,
              COALESCE(session.started_at, session.created_at) starts_at
       FROM live_pk_sessions session INNER JOIN live_rooms source ON source.id = session.source_room_id
       INNER JOIN live_rooms target ON target.id = session.target_room_id
       WHERE session.id = ? AND (source.host_application_user_id = ? OR target.host_application_user_id = ?) LIMIT 1 FOR UPDATE`,
      [input.sessionId, identity.userId, identity.userId],
    );
    const session = rows[0];
    if (!session) throw new Error("The PK session could not be closed.");
    if (["REJECTED", "CANCELLED", "EXPIRED"].includes(session.status)) {
      return { id: session.id, status: session.status.toLowerCase(), sourceRoomCode: session.source_room_code, targetRoomCode: session.target_room_code };
    }
    if (session.status === "COMPLETED") {
      const callerRoomId = identity.userId === session.source_host_id ? session.source_room_id : session.target_room_id;
      const result = session.winner_room_id == null ? "draw" : session.winner_room_id === callerRoomId ? "win" : "loss";
      return { id: session.id, status: "completed", sourceScore: Number(session.source_score), targetScore: Number(session.target_score), result, winner: session.winner_room_id ?? "draw", sourceRoomCode: session.source_room_code, targetRoomCode: session.target_room_code };
    }
    if (!["REQUESTED", "ACTIVE"].includes(session.status)) throw new Error("The PK session could not be closed.");
    if (!input.completed) {
      await connection.execute("UPDATE live_pk_sessions SET status = 'CANCELLED', ended_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [session.id]);
      return { id: session.id, status: "cancelled", sourceRoomCode: session.source_room_code, targetRoomCode: session.target_room_code };
    }
    const [scores] = await connection.query<(RowDataPacket & { room_id: string; score: number })[]>(
      `SELECT event.room_id, COALESCE(SUM(event.coin_value), 0) score
       FROM live_room_gift_events event
       WHERE event.room_id IN (?, ?) AND event.created_at >= ?
       GROUP BY event.room_id`,
      [session.source_room_id, session.target_room_id, session.starts_at],
    );
    const sourceScore = Number(scores.find((row) => row.room_id === session.source_room_id)?.score ?? 0);
    const targetScore = Number(scores.find((row) => row.room_id === session.target_room_id)?.score ?? 0);
    const winnerRoomId = sourceScore === targetScore ? null : sourceScore > targetScore ? session.source_room_id : session.target_room_id;
    await connection.execute(
      "UPDATE live_pk_sessions SET status = 'COMPLETED', source_score = ?, target_score = ?, winner_room_id = ?, ended_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
      [sourceScore, targetScore, winnerRoomId, session.id],
    );
    const sourceResult = winnerRoomId == null ? "DRAW" : winnerRoomId === session.source_room_id ? "WIN" : "LOSS";
    const targetResult = winnerRoomId == null ? "DRAW" : winnerRoomId === session.target_room_id ? "WIN" : "LOSS";
    const sourceStreak = await applyPkHostResult(connection, { sessionId: session.id, hostUserId: session.source_host_id, result: sourceResult, receivedCoins: sourceScore });
    const targetStreak = await applyPkHostResult(connection, { sessionId: session.id, hostUserId: session.target_host_id, result: targetResult, receivedCoins: targetScore });
    const callerResult = identity.userId === session.source_host_id ? sourceResult : targetResult;
    const callerStreak = identity.userId === session.source_host_id ? sourceStreak : targetStreak;
    const opponentStreak = identity.userId === session.source_host_id ? targetStreak : sourceStreak;
    return {
      id: session.id, status: "completed", sourceScore, targetScore,
      result: callerResult.toLowerCase(), winner: winnerRoomId == null ? "draw" : winnerRoomId,
      streak: callerStreak.streak, qualifyingWin: callerStreak.qualifying === true, bonusCoins: callerStreak.bonusCoins,
      opponentStreak: opponentStreak.streak,
      sourceRoomCode: session.source_room_code,
      targetRoomCode: session.target_room_code,
    };
  });
}

export async function settlePreviousWeeklyGifterRewards() {
  return withTransaction(async (connection) => {
    const [clock] = await connection.query<(RowDataPacket & { week_start: string; week_end: string })[]>(
      `SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL WEEKDAY(CURRENT_DATE) + 7 DAY), '%Y-%m-%d') week_start,
              DATE_FORMAT(DATE_SUB(CURRENT_DATE, INTERVAL WEEKDAY(CURRENT_DATE) DAY), '%Y-%m-%d') week_end`,
    );
    const weekStart = String(clock[0].week_start).slice(0, 10);
    const weekEnd = String(clock[0].week_end).slice(0, 10);
    const [inserted] = await connection.execute<ResultSetHeader>(
      "INSERT IGNORE INTO weekly_gifter_reward_runs (week_start, week_end) VALUES (?, ?)",
      [weekStart, weekEnd],
    );
    if (inserted.affectedRows !== 1) return { settled: false, weekStart };
    const [rankings] = await connection.query<(RowDataPacket & { application_user_id: string; gifted_coins: number })[]>(
      `SELECT ledger.source_id application_user_id, SUM(ledger.amount) gifted_coins
       FROM ledger_transactions ledger
       WHERE ledger.transaction_type = 'GIFT_SPEND' AND ledger.status = 'COMPLETED'
         AND ledger.created_at >= ? AND ledger.created_at < ?
       GROUP BY ledger.source_id ORDER BY gifted_coins DESC, MIN(ledger.created_at), ledger.source_id LIMIT 3`,
      [weekStart, weekEnd],
    );
    const rates = [250, 150, 100];
    let totalRewards = 0;
    for (let index = 0; index < rankings.length; index += 1) {
      const row = rankings[index];
      const reward = Math.floor(Number(row.gifted_coins) * rates[index] / 10000);
      if (reward <= 0) continue;
      await ensureCoinWallet(connection, row.application_user_id);
      const [wallets] = await connection.query<(RowDataPacket & { id: string })[]>(
        "SELECT id FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' LIMIT 1 FOR UPDATE",
        [row.application_user_id],
      );
      const ledgerId = randomUUID();
      await connection.execute("UPDATE wallet_balances SET available_balance = available_balance + ? WHERE id = ?", [reward, wallets[0].id]);
      await connection.execute(
        `INSERT INTO ledger_transactions
          (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, destination_type, destination_id, amount, status, reason)
         VALUES (?, ?, ?, 'COIN', 'WEEKLY_GIFTER_REWARD', 'SYSTEM', 'APPLICATION_USER', ?, ?, 'COMPLETED', ?)`,
        [ledgerId, transactionCode("WK"), `weekly-gifter:${weekStart}:${index + 1}`, row.application_user_id, reward, `Weekly Top Gifter rank ${index + 1}`],
      );
      await connection.execute(
        `INSERT INTO weekly_gifter_rewards
          (id, week_start, rank_number, application_user_id, gifted_coins, reward_basis_points, reward_coins, ledger_transaction_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), weekStart, index + 1, row.application_user_id, row.gifted_coins, rates[index], reward, ledgerId],
      );
      await connection.execute(
        "INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'RANKING_REWARD', 'Weekly ranking reward', ?, 'leaderboards')",
        [randomUUID(), row.application_user_id, `Rank ${index + 1}: ${reward} coins added.`],
      );
      totalRewards += reward;
    }
    await connection.execute(
      "UPDATE weekly_gifter_reward_runs SET status = 'COMPLETED', winners_count = ?, total_reward_coins = ?, completed_at = CURRENT_TIMESTAMP(3) WHERE week_start = ?",
      [rankings.length, totalRewards, weekStart],
    );
    return { settled: true, weekStart, winners: rankings.length, totalRewards };
  });
}
