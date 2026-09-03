import "server-only";

import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import type { Scope } from "@/types/platform";

async function audit(connection: PoolConnection, scope: Scope, input: { action: string; targetType: string; targetId: string; reason: string; previous?: object; next?: object }) {
  await connection.execute(
    `INSERT INTO audit_logs
      (id, actor_account_id, actor_role, action, module, target_type, target_id, previous_data, new_data, reason)
     VALUES (?, ?, ?, ?, 'PRODUCT_COMPLETION', ?, ?, ?, ?, ?)`,
    [randomUUID(), scope.account.id, scope.account.role, input.action, input.targetType, input.targetId,
      input.previous ? JSON.stringify(input.previous) : null, input.next ? JSON.stringify(input.next) : null, input.reason],
  );
}

export async function getCompletionAdminSettings() {
  const [daily, conversion, hostRules, rocketTiers, rocketSetting, vipTiers] = await Promise.all([
    db().query<RowDataPacket[]>("SELECT day_number, reward_coins, label, enabled FROM daily_reward_rules ORDER BY day_number"),
    db().query<RowDataPacket[]>("SELECT diamonds, coins, minimum_diamonds, maximum_diamonds, enabled, effective_from FROM diamond_conversion_rules ORDER BY effective_from DESC LIMIT 1"),
    db().query<RowDataPacket[]>("SELECT room_type, coins_per_hour, minimum_eligible_seconds, enabled FROM host_reward_rules WHERE enabled = TRUE ORDER BY FIELD(room_type, 'LIVE','FACE','PARTY'), effective_from DESC"),
    db().query<RowDataPacket[]>("SELECT level, name, target_coins, top1_reward_coins, top2_reward_coins, top3_reward_coins, room_reward_coins, active FROM rocket_tiers ORDER BY level"),
    db().query<RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.room_features' LIMIT 1"),
    db().query<RowDataPacket[]>("SELECT tier, name, price_coins, daily_reward_coins, validity_days FROM vip_tiers WHERE active = TRUE ORDER BY tier"),
  ]);
  const rawRocket = rocketSetting[0][0]?.setting_value;
  const rocketPolicy = (typeof rawRocket === "string" ? JSON.parse(rawRocket) : rawRocket ?? {}) as Record<string, unknown>;
  return {
    dailyRewards: daily[0].map((row) => ({ dayNumber: Number(row.day_number), coins: Number(row.reward_coins), label: String(row.label), enabled: Boolean(row.enabled) })),
    conversion: conversion[0][0] ? { diamonds: Number(conversion[0][0].diamonds), coins: Number(conversion[0][0].coins), minimum: Number(conversion[0][0].minimum_diamonds), maximum: Number(conversion[0][0].maximum_diamonds), enabled: Boolean(conversion[0][0].enabled) } : null,
    hostRules: hostRules[0].map((row) => ({ roomType: String(row.room_type), coinsPerHour: Number(row.coins_per_hour), minimumEligibleSeconds: Number(row.minimum_eligible_seconds), enabled: Boolean(row.enabled) })),
    rocket: {
      enabled: rocketPolicy.rocketEnabled !== false,
      energyPerCoin: Number(rocketPolicy.rocketEnergyPerCoin ?? 1),
      minimumUserLevel: Number(rocketPolicy.rocketMinimumUserLevel ?? 1),
      minimumVipTier: Number(rocketPolicy.rocketMinimumVipTier ?? 0),
      vipEnergyBonusPercent: Number(rocketPolicy.rocketVipEnergyBonusPercent ?? 0),
      tiers: rocketTiers[0].map((row) => ({
        level: Number(row.level), name: String(row.name), target: Number(row.target_coins),
        top1: Number(row.top1_reward_coins), top2: Number(row.top2_reward_coins), top3: Number(row.top3_reward_coins),
        room: Number(row.room_reward_coins), active: Boolean(row.active),
      })),
    },
    vipTiers: vipTiers[0].map((row) => ({
      tier: Number(row.tier), name: String(row.name), priceCoins: Number(row.price_coins),
      dailyRewardCoins: Number(row.daily_reward_coins), validityDays: Number(row.validity_days ?? 30),
    })),
  };
}

export async function saveVipValidity(input: { scope: Scope; validityDays: number[]; reason: string }) {
  if (input.validityDays.length !== 5 || input.validityDays.some((days) => !Number.isSafeInteger(days) || days < 1 || days > 3650)) {
    throw new Error("Configure a valid duration for all five VIP tiers.");
  }
  await withTransaction(async (connection) => {
    const [previous] = await connection.query<RowDataPacket[]>(
      "SELECT tier, validity_days FROM vip_tiers ORDER BY tier FOR UPDATE",
    );
    for (let index = 0; index < input.validityDays.length; index += 1) {
      await connection.execute("UPDATE vip_tiers SET validity_days = ? WHERE tier = ?", [input.validityDays[index], index + 1]);
    }
    await audit(connection, input.scope, {
      action: "vip.validity_update", targetType: "VIP_CONFIGURATION", targetId: "vip", reason: input.reason,
      previous: { tiers: previous }, next: { validityDays: input.validityDays },
    });
  });
}

export async function saveRocketSettings(input: {
  scope: Scope; enabled: boolean; energyPerCoin: number; minimumUserLevel: number; minimumVipTier: number;
  vipEnergyBonusPercent: number; reason: string;
  tiers: { level: number; target: number; top1: number; top2: number; top3: number; room: number }[];
}) {
  if (input.tiers.length !== 6 || input.tiers.some((tier, index) => tier.level !== index + 1 || tier.target < 1)) throw new Error("Configure all six Rocket levels in order.");
  await withTransaction(async (connection) => {
    const [previousTiers] = await connection.query<RowDataPacket[]>("SELECT level, target_coins, top1_reward_coins, top2_reward_coins, top3_reward_coins, room_reward_coins, active FROM rocket_tiers ORDER BY level FOR UPDATE");
    const [settingRows] = await connection.query<(RowDataPacket & { setting_value: unknown })[]>("SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.room_features' LIMIT 1 FOR UPDATE");
    const raw = settingRows[0]?.setting_value;
    const current = (typeof raw === "string" ? JSON.parse(raw) : raw ?? {}) as Record<string, unknown>;
    for (const tier of input.tiers) {
      await connection.execute(
        `UPDATE rocket_tiers SET target_coins = ?, top1_reward_coins = ?, top2_reward_coins = ?, top3_reward_coins = ?,
          room_reward_coins = ?, active = TRUE WHERE level = ?`,
        [tier.target, tier.top1, tier.top2, tier.top3, tier.room, tier.level],
      );
    }
    const nextPolicy = {
      ...current,
      rocketEnabled: input.enabled,
      rocketEnergyPerCoin: input.energyPerCoin,
      rocketMinimumUserLevel: input.minimumUserLevel,
      rocketMinimumVipTier: input.minimumVipTier,
      rocketVipEnergyBonusPercent: input.vipEnergyBonusPercent,
      rocketResetTimezone: "Asia/Kolkata",
    };
    await connection.execute(
      `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES ('mobile.room_features', ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
      [JSON.stringify(nextPolicy), input.scope.account.id],
    );
    await audit(connection, input.scope, {
      action: "rocket.settings_update", targetType: "ROCKET_CONFIGURATION", targetId: "rocket", reason: input.reason,
      previous: { tiers: previousTiers, policy: current }, next: { tiers: input.tiers, policy: nextPolicy },
    });
  });
}

export async function saveDailyRewardRules(input: { scope: Scope; coins: number[]; reason: string }) {
  if (input.coins.length !== 7 || input.coins.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error("Configure exactly seven non-negative daily rewards.");
  await withTransaction(async (connection) => {
    const [previous] = await connection.query<RowDataPacket[]>("SELECT day_number, reward_coins FROM daily_reward_rules ORDER BY day_number FOR UPDATE");
    for (let index = 0; index < 7; index++) {
      await connection.execute(
        `INSERT INTO daily_reward_rules (id, day_number, reward_coins, label, enabled, updated_by)
         VALUES (?, ?, ?, ?, TRUE, ?)
         ON DUPLICATE KEY UPDATE reward_coins = VALUES(reward_coins), label = VALUES(label), enabled = TRUE, updated_by = VALUES(updated_by)`,
        [randomUUID(), index + 1, input.coins[index], index === 6 ? "Day 7 bonus" : `Day ${index + 1}`, input.scope.account.id],
      );
    }
    await audit(connection, input.scope, { action: "daily_rewards.update", targetType: "DAILY_REWARD_RULE", targetId: input.scope.account.id, reason: input.reason, previous: { rules: previous }, next: { coins: input.coins } });
  });
}

export async function saveDiamondConversionRule(input: { scope: Scope; diamonds: number; coins: number; minimum: number; maximum: number; reason: string }) {
  if (input.minimum % input.diamonds !== 0 || input.maximum < input.minimum || input.maximum % input.diamonds !== 0) throw new Error("Minimum and maximum must be valid multiples of the diamond step.");
  await withTransaction(async (connection) => {
    const [previous] = await connection.query<RowDataPacket[]>("SELECT id, diamonds, coins, minimum_diamonds, maximum_diamonds FROM diamond_conversion_rules WHERE enabled = TRUE FOR UPDATE");
    await connection.execute("UPDATE diamond_conversion_rules SET enabled = FALSE WHERE enabled = TRUE");
    const id = randomUUID();
    await connection.execute(
      `INSERT INTO diamond_conversion_rules
        (id, diamonds, coins, minimum_diamonds, maximum_diamonds, enabled, effective_from, updated_by)
       VALUES (?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP(3), ?)`,
      [id, input.diamonds, input.coins, input.minimum, input.maximum, input.scope.account.id],
    );
    await audit(connection, input.scope, { action: "diamond_conversion.update", targetType: "DIAMOND_CONVERSION_RULE", targetId: id, reason: input.reason, previous: { rules: previous }, next: { diamonds: input.diamonds, coins: input.coins, minimum: input.minimum, maximum: input.maximum } });
  });
}

export async function saveHostRewardRules(input: { scope: Scope; live: number; face: number; party: number; minimumEligibleSeconds: number; reason: string }) {
  if (![input.live, input.face, input.party].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error("Host reward rates must be non-negative whole Diamonds.");
  if (input.party !== 0) throw new Error("Party Audio hourly reward must remain zero.");
  if (!Number.isSafeInteger(input.minimumEligibleSeconds) || input.minimumEligibleSeconds < 1) throw new Error("Minimum eligible time must be at least one second.");
  await withTransaction(async (connection) => {
    const [previous] = await connection.query<RowDataPacket[]>("SELECT room_type, coins_per_hour, minimum_eligible_seconds FROM host_reward_rules WHERE enabled = TRUE FOR UPDATE");
    for (const [roomType, rate] of [["LIVE", input.live], ["FACE", input.face], ["PARTY", input.party]] as const) {
      await connection.execute("UPDATE host_reward_rules SET enabled = FALSE WHERE room_type = ? AND enabled = TRUE", [roomType]);
      await connection.execute(
        `INSERT INTO host_reward_rules
          (id, room_type, coins_per_hour, minimum_eligible_seconds, enabled, effective_from, updated_by)
         VALUES (?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP(3), ?)`,
        [randomUUID(), roomType, rate, input.minimumEligibleSeconds, input.scope.account.id],
      );
    }
    await audit(connection, input.scope, { action: "host_rewards.update", targetType: "HOST_REWARD_RULE", targetId: input.scope.account.id, reason: input.reason, previous: { rules: previous }, next: { live: input.live, face: input.face, party: input.party, minimumEligibleSeconds: input.minimumEligibleSeconds } });
  });
}
