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
  const [daily, conversion, hostRules] = await Promise.all([
    db().query<RowDataPacket[]>("SELECT day_number, reward_coins, label, enabled FROM daily_reward_rules ORDER BY day_number"),
    db().query<RowDataPacket[]>("SELECT diamonds, coins, minimum_diamonds, maximum_diamonds, enabled, effective_from FROM diamond_conversion_rules ORDER BY effective_from DESC LIMIT 1"),
    db().query<RowDataPacket[]>("SELECT room_type, coins_per_hour, minimum_eligible_seconds, enabled FROM host_reward_rules WHERE enabled = TRUE ORDER BY FIELD(room_type, 'LIVE','FACE','PARTY'), effective_from DESC"),
  ]);
  return {
    dailyRewards: daily[0].map((row) => ({ dayNumber: Number(row.day_number), coins: Number(row.reward_coins), label: String(row.label), enabled: Boolean(row.enabled) })),
    conversion: conversion[0][0] ? { diamonds: Number(conversion[0][0].diamonds), coins: Number(conversion[0][0].coins), minimum: Number(conversion[0][0].minimum_diamonds), maximum: Number(conversion[0][0].maximum_diamonds), enabled: Boolean(conversion[0][0].enabled) } : null,
    hostRules: hostRules[0].map((row) => ({ roomType: String(row.room_type), coinsPerHour: Number(row.coins_per_hour), minimumEligibleSeconds: Number(row.minimum_eligible_seconds), enabled: Boolean(row.enabled) })),
  };
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
  if (![input.live, input.face, input.party].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error("Host reward rates must be non-negative whole coins.");
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

export async function setFaceLiveAuthorization(input: { scope: Scope; userPublicId: string; authorizationType: "AGENCY_FACE_LIVE" | "SUPER_ADMIN_FACE_LIVE"; approved: boolean; reason: string }) {
  const role = input.scope.account.role;
  if (input.authorizationType === "AGENCY_FACE_LIVE" && role !== "AGENCY" && role !== "MASTER") throw new Error("Only the user’s Agency or Master can change Agency Face Live authorization.");
  if (input.authorizationType === "SUPER_ADMIN_FACE_LIVE" && !["SUPER_ADMIN", "COUNTRY_MANAGER", "MASTER"].includes(role)) throw new Error("Only the assigned Super Admin, Country Manager, or Master can change team Face Live authorization.");
  await withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { id: string; agency_account_id: string | null; face_verification_status: string; agency_face_live_authorized: number; super_admin_face_live_authorized: number })[]>(
      "SELECT id, agency_account_id, face_verification_status, agency_face_live_authorized, super_admin_face_live_authorized FROM application_users WHERE public_id = ? AND account_status = 'ACTIVE' LIMIT 1 FOR UPDATE",
      [input.userPublicId],
    );
    const user = rows[0];
    if (!user) throw new Error("Active user was not found.");
    if (!input.scope.isGlobal && (!user.agency_account_id || !input.scope.accountIds.includes(user.agency_account_id))) throw new Error("This user is outside your permitted hierarchy.");
    if (user.face_verification_status !== "VERIFIED") throw new Error("Face Live authorization requires completed automatic Face Verification.");
    if (input.authorizationType === "AGENCY_FACE_LIVE") {
      if (!user.agency_account_id) throw new Error("The user is not linked to an approved Agency.");
      if (role === "AGENCY" && user.agency_account_id !== input.scope.account.id) throw new Error("This user is not linked to your Agency.");
      await connection.execute("UPDATE application_users SET agency_face_live_authorized = ? WHERE id = ?", [input.approved, user.id]);
    } else {
      await connection.execute("UPDATE application_users SET super_admin_face_live_authorized = ? WHERE id = ?", [input.approved, user.id]);
    }
    await connection.execute(
      `INSERT INTO live_access_authorization_history
        (id, application_user_id, authorization_type, decision, actor_account_id, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), user.id, input.authorizationType, input.approved ? "APPROVED" : "REVOKED", input.scope.account.id, input.reason],
    );
    await audit(connection, input.scope, { action: "face_live.authorization", targetType: "APPLICATION_USER", targetId: user.id, reason: input.reason, previous: { agency: Boolean(user.agency_face_live_authorized), superAdmin: Boolean(user.super_admin_face_live_authorized) }, next: { type: input.authorizationType, approved: input.approved } });
  });
}
