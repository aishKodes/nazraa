import "server-only";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { scopeWhere } from "@/lib/db/repositories/accounts";
import type { Scope } from "@/types/platform";
import type { PreparedPublicImage } from "@/lib/security/public-images";
import { can } from "@/lib/auth/permissions";
import { mobileGamesConfig, type ConfigurableGameId } from "@/lib/games/game-config";

async function auditedMutation(input: { scope: Scope; action: string; module: string; targetType: string; targetId: string; reason: string; run: Parameters<typeof withTransaction>[0] }) {
  await withTransaction(async (connection) => {
    await input.run(connection);
    await connection.execute(
      `INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), input.scope.account.id, input.scope.account.role, input.action, input.module, input.targetType, input.targetId, input.reason],
    );
  });
}

export async function listGifts() {
  const [rows] = await db().query<(RowDataPacket & { id: string; gift_key: string; name: string; category: string; catalog_type: string; emoji: string | null; coin_price: number; visual_url: string | null; animation_key: string | null; active: number; updated_at: string })[]>(
    "SELECT id, gift_key, name, category, catalog_type, emoji, coin_price, visual_url, animation_key, active, updated_at FROM gift_catalog ORDER BY active DESC, catalog_type, coin_price, name",
  );
  return rows.map((row) => ({ id: row.id, key: row.gift_key, name: row.name, category: row.category, catalogType: row.catalog_type, emoji: row.emoji, coinPrice: Number(row.coin_price), visualUrl: row.visual_url, animationKey: row.animation_key, active: Boolean(row.active), updatedAt: row.updated_at }));
}

export async function createGift(input: { scope: Scope; key: string; name: string; category: string; catalogType: "VIRTUAL_GIFT" | "ENTRY_FRAME" | "PROFILE_EFFECT" | "MEDAL" | "BADGE"; emoji?: string; coinPrice: number; image?: PreparedPublicImage; animationKey?: string }) {
  const id = randomUUID();
  const assetId = input.image ? randomUUID() : null;
  const visualUrl = assetId ? `https://nazraa.vercel.app/api/v1/assets/gifts/${assetId}` : null;
  await auditedMutation({ scope: input.scope, action: "gift.create", module: "gifts", targetType: "gift", targetId: id, reason: "Created gift catalogue entry", run: async (connection) => {
    if (input.image && assetId) {
      await connection.execute("INSERT INTO gift_assets (id, mime_type, image_data, byte_size, original_name, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)", [assetId, input.image.mimeType, input.image.data, input.image.byteSize, input.image.originalName, input.scope.account.id]);
    }
    await connection.execute("INSERT INTO gift_catalog (id, gift_key, name, category, catalog_type, emoji, coin_price, visual_url, animation_key, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, input.key, input.name, input.category, input.catalogType, input.emoji || null, input.coinPrice, visualUrl, input.animationKey || null, input.scope.account.id]);
  } });
}

export async function updateGift(input: { scope: Scope; id: string; name: string; category: string; catalogType: "VIRTUAL_GIFT" | "ENTRY_FRAME" | "PROFILE_EFFECT" | "MEDAL" | "BADGE"; artworkMode: "EMOJI" | "IMAGE"; emoji?: string; coinPrice: number; image?: PreparedPublicImage; animationKey?: string; reason: string }) {
  await auditedMutation({ scope: input.scope, action: "gift.update", module: "gifts", targetType: "gift", targetId: input.id, reason: input.reason, run: async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { visual_url: string | null })[]>("SELECT visual_url FROM gift_catalog WHERE id = ? LIMIT 1 FOR UPDATE", [input.id]);
    if (!rows[0]) throw new Error("Gift was not found.");
    let visualUrl = input.artworkMode === "IMAGE" ? rows[0].visual_url : null;
    if (input.artworkMode === "IMAGE" && input.image) {
      const assetId = randomUUID();
      visualUrl = `https://nazraa.vercel.app/api/v1/assets/gifts/${assetId}`;
      await connection.execute("INSERT INTO gift_assets (id, mime_type, image_data, byte_size, original_name, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)", [assetId, input.image.mimeType, input.image.data, input.image.byteSize, input.image.originalName, input.scope.account.id]);
    }
    if (input.artworkMode === "IMAGE" && !visualUrl) throw new Error("Upload a gift picture.");
    await connection.execute(
      "UPDATE gift_catalog SET name = ?, category = ?, catalog_type = ?, emoji = ?, coin_price = ?, visual_url = ?, animation_key = ? WHERE id = ?",
      [input.name, input.category, input.catalogType, input.artworkMode === "EMOJI" ? input.emoji || "🎁" : null, input.coinPrice, visualUrl, input.animationKey || null, input.id],
    );
  } });
}

export async function setGiftActive(input: { scope: Scope; id: string; active: boolean }) {
  await auditedMutation({ scope: input.scope, action: "gift.status_change", module: "gifts", targetType: "gift", targetId: input.id, reason: input.active ? "Enabled gift" : "Disabled gift", run: async (connection) => {
    await connection.execute("UPDATE gift_catalog SET active = ? WHERE id = ?", [input.active, input.id]);
  } });
}

export async function listBanners(page = 1) {
  const [rows] = await db().query<(RowDataPacket & { id: string; placement: string; title: string; subtitle: string | null; image_url: string; action_type: string; action_target: string | null; starts_at: string | null; ends_at: string | null; priority: number; active: number })[]>(
    "SELECT id, placement, title, subtitle, image_url, action_type, action_target, starts_at, ends_at, priority, active FROM banners ORDER BY active DESC, priority DESC, created_at DESC LIMIT 26 OFFSET ?", [(Math.max(1, Math.trunc(page)) - 1) * 25],
  );
  return rows.map((row) => ({ id: row.id, placement: row.placement, title: row.title, subtitle: row.subtitle, imageUrl: row.image_url, actionType: row.action_type, actionTarget: row.action_target, startsAt: row.starts_at, endsAt: row.ends_at, priority: row.priority, active: Boolean(row.active) }));
}

export async function createBanner(input: { scope: Scope; placement: string; title: string; subtitle?: string; image: PreparedPublicImage; actionType: string; actionTarget?: string; startsAt?: string; endsAt?: string; priority: number; enabled: boolean }) {
  const id = randomUUID();
  const assetId = randomUUID();
  const imageUrl = `https://nazraa.vercel.app/api/v1/assets/banners/${assetId}`;
  await auditedMutation({ scope: input.scope, action: "banner.create", module: "banners", targetType: "banner", targetId: id, reason: "Created scheduled banner", run: async (connection) => {
    await connection.execute("INSERT INTO banner_assets (id, mime_type, image_data, byte_size, original_name, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)", [assetId, input.image.mimeType, input.image.data, input.image.byteSize, input.image.originalName, input.scope.account.id]);
    await connection.execute("INSERT INTO banners (id, placement, title, subtitle, image_url, action_type, action_target, starts_at, ends_at, priority, active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, input.placement, input.title, input.subtitle || null, imageUrl, input.actionType, input.actionTarget || null, input.startsAt || null, input.endsAt || null, input.priority, input.enabled, input.scope.account.id]);
  } });
}

export async function setBannerActive(input: { scope: Scope; id: string; active: boolean }) {
  await auditedMutation({ scope: input.scope, action: "banner.status_change", module: "banners", targetType: "banner", targetId: input.id, reason: input.active ? "Enabled banner" : "Disabled banner", run: async (connection) => { await connection.execute("UPDATE banners SET active = ? WHERE id = ?", [input.active, input.id]); } });
}

export async function deleteBanner(input: { scope: Scope; id: string; reason: string; confirmed: boolean }) {
  if (!can(input.scope.account.role, "banners.manage") || !input.confirmed || input.reason.trim().length < 5) throw new Error("Banner deletion requires permission, confirmation, and a reason.");
  await withTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT id, title, placement, image_url, active FROM banners WHERE id = ? LIMIT 1 FOR UPDATE", [input.id]);
    if (!rows[0]) throw new Error("Banner was not found or has already been deleted.");
    await connection.execute("DELETE FROM banners WHERE id = ?", [input.id]);
    await connection.execute("INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, previous_data, reason) VALUES (?, ?, ?, 'banner.delete', 'banners', 'banner', ?, ?, ?)", [randomUUID(), input.scope.account.id, input.scope.account.role, input.id, JSON.stringify(rows[0]), input.reason]);
  });
}

export async function listNotifications() {
  const [rows] = await db().query<(RowDataPacket & { id: string; title: string; message: string; audience_role: string | null; status: string; scheduled_at: string | null; published_at: string | null; created_at: string })[]>(
    "SELECT id, title, message, audience_role, status, scheduled_at, published_at, created_at FROM platform_notifications ORDER BY created_at DESC LIMIT 50",
  );
  return rows.map((row) => ({ id: row.id, title: row.title, message: row.message, audienceRole: row.audience_role, status: row.status, scheduledAt: row.scheduled_at, publishedAt: row.published_at, createdAt: row.created_at }));
}

export async function createNotification(input: { scope: Scope; title: string; message: string; audienceRole?: string; actionTarget?: string; scheduledAt?: string }) {
  const id = randomUUID(); const scheduled = Boolean(input.scheduledAt);
  await auditedMutation({ scope: input.scope, action: "notification.create", module: "notifications", targetType: "notification", targetId: id, reason: scheduled ? "Scheduled notification" : "Published notification", run: async (connection) => {
    await connection.execute(
      `INSERT INTO platform_notifications (id, title, message, audience_role, action_target, status, scheduled_at, published_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.title, input.message, input.audienceRole || null, input.actionTarget || null, scheduled ? "SCHEDULED" : "PUBLISHED", input.scheduledAt || null, scheduled ? null : new Date(), input.scope.account.id],
    );
  } });
}

export async function listSupportTickets(scope: Scope, page = 1) {
  const filter = scopeWhere(scope, "u.agency_account_id");
  const [rows] = await db().query<(RowDataPacket & { id: string; ticket_code: string; subject: string; category: string; priority: string; status: string; full_name: string | null; external_user_id: string | null; assignee: string | null; updated_at: string })[]>(
    `SELECT t.id, t.ticket_code, t.subject, t.category, t.priority, t.status, u.full_name, u.external_user_id, a.full_name assignee, t.updated_at
     FROM support_tickets t LEFT JOIN application_users u ON u.id = t.application_user_id LEFT JOIN platform_accounts a ON a.id = t.assigned_to
     WHERE ${filter.clause} ORDER BY FIELD(t.priority, 'URGENT','HIGH','NORMAL','LOW'), t.updated_at DESC LIMIT 26 OFFSET ?`, [...filter.values, (Math.max(1, Math.trunc(page)) - 1) * 25],
  );
  if (!rows.length) return [];
  const [messages] = await db().query<(RowDataPacket & { id: string; ticket_id: string; sender_type: string; message: string; internal_note: number; created_at: string })[]>(
    `SELECT id, ticket_id, sender_type, message, internal_note, created_at FROM support_messages WHERE ticket_id IN (${rows.map(() => "?").join(",")}) ORDER BY created_at`,
    rows.map((row) => row.id),
  );
  const messagesByTicket = new Map<string, typeof messages>();
  for (const message of messages) {
    const thread = messagesByTicket.get(message.ticket_id) ?? [];
    thread.push(message);
    messagesByTicket.set(message.ticket_id, thread);
  }
  return rows.map((row) => ({
    id: row.id, code: row.ticket_code, subject: row.subject, category: row.category, priority: row.priority, status: row.status, userName: row.full_name, externalUserId: row.external_user_id, assignee: row.assignee, updatedAt: row.updated_at,
    messages: (messagesByTicket.get(row.id) ?? []).map((message) => ({ id: message.id, senderType: message.sender_type, message: message.message, internalNote: Boolean(message.internal_note), createdAt: message.created_at })),
  }));
}

export async function updateSupportTicket(input: { scope: Scope; ticketId: string; status: string; message: string; internalNote: boolean }) {
  const filter = scopeWhere(input.scope, "u.agency_account_id");
  await withTransaction(async (connection) => {
    const [tickets] = await connection.query<RowDataPacket[]>(
      `SELECT t.id FROM support_tickets t LEFT JOIN application_users u ON u.id = t.application_user_id WHERE t.id = ? AND ${filter.clause} LIMIT 1 FOR UPDATE`,
      [input.ticketId, ...filter.values],
    );
    if (!tickets[0]) throw new Error("Ticket was not found in your permitted scope.");
    await connection.execute("UPDATE support_tickets SET status = ?, assigned_to = ? WHERE id = ?", [input.status, input.scope.account.id, input.ticketId]);
    await connection.execute("INSERT INTO support_messages (id, ticket_id, sender_type, sender_id, message, internal_note) VALUES (?, ?, 'PLATFORM_ACCOUNT', ?, ?, ?)", [randomUUID(), input.ticketId, input.scope.account.id, input.message, input.internalNote]);
    await connection.execute("INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, reason) VALUES (?, ?, ?, 'support.update', 'support', 'support_ticket', ?, ?)", [randomUUID(), input.scope.account.id, input.scope.account.role, input.ticketId, input.internalNote ? "Internal support note" : "User-visible support reply"]);
  });
}

export async function getSystemSettings() {
  const [rows] = await db().query<(RowDataPacket & { setting_key: string; setting_value: unknown; updated_at: string })[]>("SELECT setting_key, setting_value, updated_at FROM system_settings ORDER BY setting_key");
  return rows.map((row) => ({ key: row.setting_key, value: typeof row.setting_value === "string" ? JSON.parse(row.setting_value) : row.setting_value, updatedAt: row.updated_at }));
}

export async function saveEconomySettings(input: { scope: Scope; rate: number; minimum: number; currency: string }) {
  await auditedMutation({ scope: input.scope, action: "settings.economy_update", module: "settings", targetType: "system_setting", targetId: "economy.diamond_conversion", reason: "Updated diamond conversion rule", run: async (connection) => {
    await connection.execute(
      `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES ('economy.diamond_conversion', ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
      [JSON.stringify({ rate: input.rate, minimum: input.minimum, currency: input.currency }), input.scope.account.id],
    );
  } });
}

export async function saveMobileAppSettings(input: { scope: Scope; minimumVersion: string; latestVersion: string; maintenance: boolean; maintenanceMessage?: string; updateUrl?: string; supportUrl?: string; withdrawalUrl?: string }) {
  await auditedMutation({ scope: input.scope, action: "settings.mobile_app_update", module: "settings", targetType: "system_setting", targetId: "mobile.app_config", reason: "Updated mobile app configuration", run: async (connection) => {
    await connection.execute(
      `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES ('mobile.app_config', ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
      [JSON.stringify({ minimumVersion: input.minimumVersion, latestVersion: input.latestVersion, maintenance: input.maintenance, maintenanceMessage: input.maintenanceMessage || "", updateUrl: input.updateUrl || "", supportUrl: input.supportUrl || "", withdrawalUrl: input.withdrawalUrl || "" }), input.scope.account.id],
    );
  } });
}

export async function saveMobileSocialSettings(input: { scope: Scope; privateMessageCoinCost: number }) {
  await auditedMutation({ scope: input.scope, action: "settings.mobile_social_update", module: "settings", targetType: "system_setting", targetId: "mobile.social", reason: "Updated mobile social pricing", run: async (connection) => {
    await connection.execute(
      `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES ('mobile.social', ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
      [JSON.stringify({ private_message_coin_cost: input.privateMessageCoinCost }), input.scope.account.id],
    );
  } });
}

export async function saveGameSettings(input: {
  scope: Scope;
  game: ConfigurableGameId;
  enabled: boolean;
  maintenance: boolean;
  targetWinRate: number;
  maximumPayoutMultiplier: number;
  bettingSeconds: number;
  minimumBet: number;
  maximumBet: number;
  denominations: number[];
  historyLength: number;
  bigWinThreshold: number;
  repeatBet: boolean;
  autoPlay: boolean;
  outcomeWeights?: number[];
  saladWeight?: number;
  pizzaWeight?: number;
  poolContributionBps?: number;
  poolMinimumForSpecial?: number;
  reason: string;
}) {
  if (input.targetWinRate < 0 || input.targetWinRate > 1) throw new Error("Target win rate must be between 0 and 1.");
  if (input.maximumPayoutMultiplier < 1 || input.maximumPayoutMultiplier > 1000) throw new Error("Maximum payout multiplier must be between 1 and 1,000.");
  if (input.maximumBet < input.minimumBet) throw new Error("Maximum bet must be at least the minimum bet.");
  if (!input.denominations.length || input.denominations.some((value) => value < 1 || value > input.maximumBet)) {
    throw new Error("Add at least one valid denomination within the game limit.");
  }
  const expectedWeights = input.game === "luck77" ? 3 : input.game === "bounty_football" ? 10 : 0;
  if (expectedWeights && input.outcomeWeights?.length !== expectedWeights) {
    throw new Error(`This game requires exactly ${expectedWeights} outcome weights.`);
  }
  if (expectedWeights && input.outcomeWeights?.some((value) => value < 0)) {
    throw new Error("Outcome weights cannot be negative.");
  }
  if (expectedWeights && !input.outcomeWeights?.some((value) => value > 0)) {
    throw new Error("At least one outcome weight must be greater than zero.");
  }
  await auditedMutation({
    scope: input.scope,
    action: "settings.game_update",
    module: "settings",
    targetType: "system_setting",
    targetId: `mobile.games:${input.game}`,
    reason: input.reason,
    run: async (connection) => {
      const [rows] = await connection.query<(RowDataPacket & { setting_value: unknown })[]>(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.games' LIMIT 1 FOR UPDATE",
      );
      const current = mobileGamesConfig(rows[0]?.setting_value);
      const previous = current.games[input.game];
      current.games[input.game] = {
        ...previous,
        enabled: input.enabled,
        maintenance: input.maintenance,
        targetWinRate: input.targetWinRate,
        maximumPayoutMultiplier: input.maximumPayoutMultiplier,
        bettingSeconds: input.bettingSeconds,
        minimumBet: input.minimumBet,
        maximumBet: input.maximumBet,
        denominations: [...new Set(input.denominations)].sort((left, right) => left - right),
        historyLength: input.historyLength,
        bigWinThreshold: input.bigWinThreshold,
        repeatBet: input.repeatBet,
        autoPlay: input.autoPlay,
        outcomeWeights: expectedWeights ? input.outcomeWeights : previous.outcomeWeights,
        saladWeight: input.saladWeight ?? previous.saladWeight,
        pizzaWeight: input.pizzaWeight ?? previous.pizzaWeight,
        poolContributionBps: input.poolContributionBps ?? previous.poolContributionBps,
        poolMinimumForSpecial: input.poolMinimumForSpecial ?? previous.poolMinimumForSpecial,
      };
      await connection.execute(
        `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES ('mobile.games', ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
        [JSON.stringify({
          targetWinRate: current.target_win_rate,
          winningsDeductionRate: current.winnings_deduction_rate,
          games: current.games,
        }), input.scope.account.id],
      );
    },
  });
}

export async function saveRoomFeatureSettings(input: {
  scope: Scope;
  interactions: { key: string; label: string; emoji: string; enabled: boolean }[];
  interactionAssetKey?: string;
  interactionAsset?: PreparedPublicImage;
  pkDurations: number[];
  pkModes: string[];
  presenceWarningLimit: number;
  presenceSuspensionLimit: number;
  facePassivePlaybackMode: "rtc_fallback" | "live_streaming";
  partyPassivePlaybackMode: "dynamic_rtc_fallback" | "live_streaming";
  partyStreamingThreshold: number;
  streamMixingEnabled: boolean;
  mediaReconnectGraceSeconds: number;
}) {
  await auditedMutation({
    scope: input.scope,
    action: "settings.room_features_update",
    module: "settings",
    targetType: "system_setting",
    targetId: "mobile.room_features",
    reason: "Updated Party and Live room feature configuration",
    run: async (connection) => {
      const [currentRows] = await connection.query<(RowDataPacket & { setting_value: unknown })[]>(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.room_features' LIMIT 1 FOR UPDATE",
      );
      const raw = currentRows[0]?.setting_value;
      const current: Record<string, unknown> & { interactions?: { key?: string; visualUrl?: string }[] } = (typeof raw === "string"
        ? JSON.parse(raw) as Record<string, unknown> & { interactions?: { key?: string; visualUrl?: string }[] }
        : raw as Record<string, unknown> & { interactions?: { key?: string; visualUrl?: string }[] } | undefined) ?? {};
      const existingAssets = new Map((current?.interactions ?? []).map((item) => [item.key, item.visualUrl]));
      let uploadedUrl: string | undefined;
      if (input.interactionAsset && input.interactionAssetKey) {
        const assetId = randomUUID();
        uploadedUrl = `https://nazraa.vercel.app/api/v1/assets/interactions/${assetId}`;
        await connection.execute(
          "INSERT INTO room_interaction_assets (id, mime_type, image_data, byte_size, original_name, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)",
          [assetId, input.interactionAsset.mimeType, input.interactionAsset.data, input.interactionAsset.byteSize, input.interactionAsset.originalName, input.scope.account.id],
        );
      }
      const interactions = input.interactions.map((item) => ({
        ...item,
        visualUrl: item.key === input.interactionAssetKey && uploadedUrl
          ? uploadedUrl
          : existingAssets.get(item.key) || undefined,
      }));
      await connection.execute(
        `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES ('mobile.room_features', ?, ?)
        ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
        [JSON.stringify({
          ...current,
          interactions,
          pkDurations: input.pkDurations,
          pkModes: input.pkModes,
          presenceWarningLimit: input.presenceWarningLimit,
          presenceSuspensionLimit: input.presenceSuspensionLimit,
          facePassivePlaybackMode: input.facePassivePlaybackMode,
          partyPassivePlaybackMode: input.partyPassivePlaybackMode,
          partyStreamingThreshold: input.partyStreamingThreshold,
          streamMixingEnabled: input.streamMixingEnabled,
          mediaReconnectGraceSeconds: input.mediaReconnectGraceSeconds,
        }), input.scope.account.id],
      );
    },
  });
}
