import "server-only";

import { randomUUID } from "crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { db } from "@/lib/db/pool";
import { withIdempotentTransaction, withTransaction } from "@/lib/db/transaction";

type CosmeticCatalogRow = RowDataPacket & {
  id: string;
  gift_key: string;
  name: string;
  catalog_type: string;
  coin_price: number;
  currency: string;
  validity_days: number;
  visual_url: string | null;
  animation_key: string | null;
  asset_config: unknown;
  active: number;
  vip_tier_eligibility?: number | null;
  sort_order?: number;
};

type EntitlementRow = CosmeticCatalogRow & {
  entitlement_id: string;
  source: "MALL" | "VIP";
  acquired_at: Date | string;
  expires_at: Date | string;
  equipped_at: Date | string | null;
  manually_unequipped_at?: Date | string | null;
};

type EquippedCosmeticRow = EntitlementRow & {
  public_id: string | number;
};

export type CosmeticLoadoutPayload = Record<string, ReturnType<typeof presentationPayload>>;

/**
 * Expiry is enforced on every authenticated mobile request, not by cron.
 * The joined update also removes VIP presentation immediately for viewers
 * already inside a room while leaving every Mall entitlement untouched.
 */
let lastVipExpirySweepAt = 0;
let vipExpirySweepInFlight: Promise<void> | null = null;

export async function expireEndedVipMemberships() {
  // This cleanup used to issue a global UPDATE before every authenticated
  // tap—including 4 Hz room presence and rapid game bets. Expiry remains
  // enforced by entitlement reads, while durable tier cleanup is coalesced on
  // each warm runtime at most once per minute instead of becoming hot-path DB
  // work for every mobile action.
  const now = Date.now();
  if (now - lastVipExpirySweepAt < 60_000) return;
  if (vipExpirySweepInFlight) return vipExpirySweepInFlight;
  vipExpirySweepInFlight = db().execute(
    `UPDATE application_users user
     LEFT JOIN user_cosmetic_entitlements entitlement
       ON entitlement.application_user_id = user.id
      AND entitlement.source = 'VIP' AND entitlement.revoked_at IS NULL
     SET user.vip_tier = 0, user.vip_expires_at = NULL,
         entitlement.equipped_at = NULL,
         entitlement.revoked_at = COALESCE(entitlement.revoked_at, CURRENT_TIMESTAMP(3))
     WHERE user.vip_tier > 0 AND user.vip_expires_at <= CURRENT_TIMESTAMP(3)`,
  ).then(() => undefined).finally(() => {
    lastVipExpirySweepAt = Date.now();
    vipExpirySweepInFlight = null;
  });
  return vipExpirySweepInFlight;
}

function presentationType(type: string) {
  return type === "ENTRY_FRAME" ? "ENTRY_EFFECT" : type;
}

function assetConfig(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function entitlementPayload(row: EntitlementRow) {
  return {
    id: String(row.entitlement_id),
    itemId: String(row.gift_key),
    source: String(row.source),
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
    equipped: row.equipped_at != null,
  };
}

function presentationPayload(row: EntitlementRow) {
  const config = assetConfig(row.asset_config);
  return {
    itemId: String(row.gift_key),
    name: String(row.name),
    type: presentationType(String(row.catalog_type)),
    visualUrl: row.visual_url == null ? null : String(row.visual_url),
    animationKey: row.animation_key == null ? null : String(row.animation_key),
    accent: Number(config.accent ?? 0xffffc857),
    source: String(row.source),
    effectConfig: config,
  };
}

/**
 * Resolve the visible, equipped cosmetics for a group of public user IDs.
 *
 * This is deliberately read-only: expiry is enforced in the predicate so an
 * expired item disappears from every other viewer immediately, even before
 * the owner's next snapshot performs the optional equipped_at cleanup.
 */
export async function equippedCosmeticLoadoutsByPublicId(
  publicIds: readonly (string | number)[],
  connection?: PoolConnection,
) {
  const ids = [...new Set(publicIds.map(String).filter((id) => id.length > 0))];
  const loadouts = new Map<string, CosmeticLoadoutPayload>();
  if (!ids.length) return loadouts;

  const placeholders = ids.map(() => "?").join(",");
  const executor = connection ?? db();
  const [rows] = await executor.query<EquippedCosmeticRow[]>(
    `SELECT user.public_id,
            entitlement.id entitlement_id, entitlement.source, entitlement.acquired_at,
            entitlement.expires_at, entitlement.equipped_at,
            catalog.id, catalog.gift_key, catalog.name, catalog.catalog_type,
            catalog.coin_price, catalog.currency, catalog.validity_days,
            catalog.visual_url, catalog.animation_key, catalog.asset_config,
            catalog.active
     FROM application_users user
     INNER JOIN user_cosmetic_entitlements entitlement
       ON entitlement.application_user_id = user.id
     INNER JOIN gift_catalog catalog ON catalog.id = entitlement.gift_catalog_id
     WHERE user.public_id IN (${placeholders})
       AND user.account_status = 'ACTIVE'
       AND entitlement.revoked_at IS NULL
       AND entitlement.expires_at > CURRENT_TIMESTAMP(3)
       AND entitlement.equipped_at IS NOT NULL
       AND catalog.active = TRUE
       AND (entitlement.source = 'MALL' OR (
         user.vip_expires_at > CURRENT_TIMESTAMP(3)
         AND catalog.vip_tier_eligibility IS NOT NULL
         AND catalog.vip_tier_eligibility <= user.vip_tier
       ))
     ORDER BY user.public_id, entitlement.equipped_at DESC, entitlement.acquired_at DESC`,
    ids,
  );
  for (const row of rows) {
    const publicId = String(row.public_id);
    const loadout = loadouts.get(publicId) ?? {};
    const type = presentationType(String(row.catalog_type));
    if (!loadout[type]) loadout[type] = presentationPayload(row);
    loadouts.set(publicId, loadout);
  }
  return loadouts;
}

async function activeEntitlementRows(connection: PoolConnection, userId: string) {
  const [rows] = await connection.query<EntitlementRow[]>(
    `SELECT entitlement.id entitlement_id, entitlement.source, entitlement.acquired_at,
            entitlement.expires_at, entitlement.equipped_at,
            catalog.id, catalog.gift_key, catalog.name, catalog.catalog_type,
            catalog.coin_price, catalog.currency, catalog.validity_days,
            catalog.visual_url, catalog.animation_key, catalog.asset_config,
            catalog.active
     FROM user_cosmetic_entitlements entitlement
     INNER JOIN gift_catalog catalog ON catalog.id = entitlement.gift_catalog_id
     WHERE entitlement.application_user_id = ? AND entitlement.revoked_at IS NULL
     ORDER BY entitlement.equipped_at IS NOT NULL DESC, entitlement.acquired_at DESC`,
    [userId],
  );
  return rows;
}

async function snapshotOnConnection(connection: PoolConnection, userId: string) {
  await connection.execute(
    `UPDATE user_cosmetic_entitlements
     SET equipped_at = NULL
     WHERE application_user_id = ? AND equipped_at IS NOT NULL
       AND (revoked_at IS NOT NULL OR expires_at <= CURRENT_TIMESTAMP(3))`,
    [userId],
  );
  const rows = await activeEntitlementRows(connection, userId);
  const loadout: CosmeticLoadoutPayload = {};
  for (const row of rows) {
    if (row.equipped_at == null || new Date(row.expires_at).getTime() <= Date.now() || !Boolean(row.active)) continue;
    const type = presentationType(String(row.catalog_type));
    if (!loadout[type]) loadout[type] = presentationPayload(row);
  }
  return {
    entitlements: rows.map(entitlementPayload),
    loadout,
  };
}

async function hasEquippedSlot(connection: PoolConnection, userId: string, catalogType: string) {
  const normalizedType = presentationType(catalogType);
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT entitlement.id
     FROM user_cosmetic_entitlements entitlement
     INNER JOIN gift_catalog catalog ON catalog.id = entitlement.gift_catalog_id
     WHERE entitlement.application_user_id = ? AND entitlement.revoked_at IS NULL
       AND entitlement.expires_at > CURRENT_TIMESTAMP(3)
       AND entitlement.equipped_at IS NOT NULL
       AND (CASE WHEN catalog.catalog_type = 'ENTRY_FRAME' THEN 'ENTRY_EFFECT' ELSE catalog.catalog_type END) = ?
     LIMIT 1 FOR UPDATE`,
    [userId, normalizedType],
  );
  return rows.length > 0;
}

/** Keep backend-configured VIP catalogue grants on the same entitlement path. */
export async function grantVipCosmetics(
  connection: PoolConnection,
  userId: string,
  tier: number,
  expiresAt: Date | string | null,
) {
  const vipIsActive = tier >= 1 && expiresAt != null && new Date(expiresAt).getTime() > Date.now();
  // Catalogue changes and membership expiry invalidate only VIP grants.
  // Paid Mall ownership is deliberately outside this cleanup.
  await connection.execute(
    `UPDATE user_cosmetic_entitlements entitlement
     INNER JOIN gift_catalog catalog ON catalog.id = entitlement.gift_catalog_id
     SET entitlement.equipped_at = NULL, entitlement.revoked_at = CURRENT_TIMESTAMP(3)
     WHERE entitlement.application_user_id = ? AND entitlement.source = 'VIP'
       AND entitlement.revoked_at IS NULL
       AND (? = 0 OR catalog.active = FALSE OR catalog.vip_tier_eligibility IS NULL
         OR catalog.vip_tier_eligibility > ?)`,
    [userId, vipIsActive ? 1 : 0, tier],
  );
  if (!vipIsActive || expiresAt == null) return;
  const [catalogRows] = await connection.query<CosmeticCatalogRow[]>(
    `SELECT id, gift_key, name, catalog_type, coin_price, currency,
            validity_days, vip_tier_eligibility, sort_order,
            visual_url, animation_key, asset_config, active
     FROM gift_catalog
     WHERE active = TRUE AND catalog_type <> 'VIRTUAL_GIFT'
       AND vip_tier_eligibility IS NOT NULL AND vip_tier_eligibility <= ?
     ORDER BY vip_tier_eligibility DESC, sort_order, coin_price DESC, name
     FOR UPDATE`,
    [tier],
  );
  const preferredBySlot = new Map<string, CosmeticCatalogRow>();
  const vipEntitlementByCatalog = new Map<string, string>();
  const manuallyUnequippedCatalog = new Set<string>();
  for (const catalog of catalogRows) {
    const slot = presentationType(String(catalog.catalog_type));
    if (!preferredBySlot.has(slot)) preferredBySlot.set(slot, catalog);
    const [existingRows] = await connection.query<(RowDataPacket & { id: string; equipped_at: Date | null; manually_unequipped_at: Date | null })[]>(
      `SELECT id, equipped_at, manually_unequipped_at FROM user_cosmetic_entitlements
       WHERE application_user_id = ? AND gift_catalog_id = ? AND source = 'VIP'
         AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP(3)
       ORDER BY acquired_at DESC LIMIT 1 FOR UPDATE`,
      [userId, catalog.id],
    );
    const existing = existingRows[0];
    if (existing) {
      vipEntitlementByCatalog.set(String(catalog.id), String(existing.id));
      if (existing.manually_unequipped_at != null) manuallyUnequippedCatalog.add(String(catalog.id));
      await connection.execute(
        "UPDATE user_cosmetic_entitlements SET expires_at = ? WHERE id = ?",
        [expiresAt, existing.id],
      );
      continue;
    }
    const entitlementId = randomUUID();
    vipEntitlementByCatalog.set(String(catalog.id), entitlementId);
    await connection.execute(
      `INSERT INTO user_cosmetic_entitlements
        (id, application_user_id, gift_catalog_id, source, expires_at, equipped_at, grant_reference)
       VALUES (?, ?, ?, 'VIP', ?, NULL, ?)`,
      [entitlementId, userId, catalog.id, expiresAt, `vip-tier:${tier}`],
    );
  }

  // A deliberate Mall choice always wins. Otherwise a VIP upgrade should
  // immediately select the richest asset configured for that slot, rather
  // than leaving the first/lower-tier grant equipped forever.
  for (const [slot, preferred] of preferredBySlot) {
    const [equippedRows] = await connection.query<(RowDataPacket & { id: string; source: "MALL" | "VIP" })[]>(
      `SELECT entitlement.id, entitlement.source
       FROM user_cosmetic_entitlements entitlement
       INNER JOIN gift_catalog catalog ON catalog.id = entitlement.gift_catalog_id
       WHERE entitlement.application_user_id = ?
         AND entitlement.revoked_at IS NULL
         AND entitlement.expires_at > CURRENT_TIMESTAMP(3)
         AND entitlement.equipped_at IS NOT NULL
         AND catalog.active = TRUE
         AND (CASE WHEN catalog.catalog_type = 'ENTRY_FRAME' THEN 'ENTRY_EFFECT' ELSE catalog.catalog_type END) = ?
       ORDER BY entitlement.source = 'MALL' DESC, entitlement.equipped_at DESC
       FOR UPDATE`,
      [userId, slot],
    );
    if (equippedRows.some((row) => row.source === "MALL")) continue;
    const targetEntitlementId = vipEntitlementByCatalog.get(String(preferred.id));
    if (!targetEntitlementId || manuallyUnequippedCatalog.has(String(preferred.id)) || equippedRows[0]?.id === targetEntitlementId) continue;
    await connection.execute(
      `UPDATE user_cosmetic_entitlements entitlement
       INNER JOIN gift_catalog catalog ON catalog.id = entitlement.gift_catalog_id
       SET entitlement.equipped_at = NULL
       WHERE entitlement.application_user_id = ? AND entitlement.equipped_at IS NOT NULL
         AND (CASE WHEN catalog.catalog_type = 'ENTRY_FRAME' THEN 'ENTRY_EFFECT' ELSE catalog.catalog_type END) = ?`,
      [userId, slot],
    );
    await connection.execute(
      "UPDATE user_cosmetic_entitlements SET equipped_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
      [targetEntitlementId],
    );
  }
}

export async function cosmeticSnapshot(identity: MobileIdentity) {
  return withTransaction(async (connection) => {
    const [users] = await connection.query<(RowDataPacket & { vip_tier: number; vip_expires_at: Date | null })[]>(
      "SELECT vip_tier, vip_expires_at FROM application_users WHERE id = ? LIMIT 1 FOR UPDATE",
      [identity.userId],
    );
    const user = users[0];
    await grantVipCosmetics(connection, identity.userId, Number(user?.vip_tier ?? 0), user?.vip_expires_at ?? null);
    return snapshotOnConnection(connection, identity.userId);
  });
}

export async function purchaseMallCosmetic(
  identity: MobileIdentity,
  input: { itemId: string; clientRequestId: string },
) {
  return withIdempotentTransaction(async (connection) => {
    const [catalogRows] = await connection.query<CosmeticCatalogRow[]>(
      `SELECT id, gift_key, name, catalog_type, coin_price, currency,
              validity_days, visual_url, animation_key, asset_config, active
       FROM gift_catalog
       WHERE gift_key = ? AND active = TRUE AND catalog_type <> 'VIRTUAL_GIFT'
       LIMIT 1 FOR UPDATE`,
      [input.itemId],
    );
    const catalog = catalogRows[0];
    if (!catalog) throw new Error("This Mall item is not available.");
    if (catalog.currency !== "COIN") throw new Error("This Mall item cannot be purchased with Coins.");

    const [requestInsert] = await connection.execute<ResultSetHeader>(
      `INSERT IGNORE INTO cosmetic_purchase_requests
        (id, request_key, application_user_id, gift_catalog_id, coin_price)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), input.clientRequestId, identity.userId, catalog.id, catalog.coin_price],
    );
    const [requestRows] = await connection.query<(RowDataPacket & {
      id: string;
      application_user_id: string;
      gift_catalog_id: string;
      entitlement_id: string | null;
      coin_price: number;
      status: "PENDING" | "COMPLETED";
    })[]>(
      "SELECT id, application_user_id, gift_catalog_id, entitlement_id, coin_price, status FROM cosmetic_purchase_requests WHERE request_key = ? LIMIT 1 FOR UPDATE",
      [input.clientRequestId],
    );
    const request = requestRows[0];
    if (!request || request.application_user_id !== identity.userId || request.gift_catalog_id !== catalog.id) {
      throw new Error("This purchase request does not match the selected item.");
    }
    if (request.status === "COMPLETED") {
      const snapshot = await snapshotOnConnection(connection, identity.userId);
      return { ...snapshot, idempotent: true, entitlementId: request.entitlement_id };
    }
    if (requestInsert.affectedRows === 0) {
      throw new Error("This purchase is still being confirmed. Please retry.");
    }

    const [ownedRows] = await connection.query<RowDataPacket[]>(
      `SELECT id FROM user_cosmetic_entitlements
       WHERE application_user_id = ? AND gift_catalog_id = ?
         AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP(3)
       LIMIT 1 FOR UPDATE`,
      [identity.userId, catalog.id],
    );
    if (ownedRows.length) throw new Error("This item is already in your bag.");

    await connection.execute(
      "INSERT IGNORE INTO wallet_balances (id, owner_type, owner_id, asset_type) VALUES (?, 'APPLICATION_USER', ?, 'COIN')",
      [randomUUID(), identity.userId],
    );
    const [walletRows] = await connection.query<(RowDataPacket & { id: string; available_balance: number })[]>(
      `SELECT id, available_balance FROM wallet_balances
       WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN'
       LIMIT 1 FOR UPDATE`,
      [identity.userId],
    );
    const wallet = walletRows[0];
    const price = Number(catalog.coin_price);
    if (!wallet || Number(wallet.available_balance) < price) throw new Error("Not enough Coins for this Mall item.");

    const equip = !(await hasEquippedSlot(connection, identity.userId, catalog.catalog_type));
    const entitlementId = randomUUID();
    const validityDays = Math.max(1, Math.min(3650, Number(catalog.validity_days ?? 30)));
    await connection.execute("UPDATE wallet_balances SET available_balance = available_balance - ? WHERE id = ?", [price, wallet.id]);
    await connection.execute(
      `INSERT INTO ledger_transactions
        (id, transaction_code, idempotency_key, asset_type, transaction_type,
         source_type, source_id, destination_type, amount, status, reason, metadata)
       VALUES (?, ?, ?, 'COIN', 'COSMETIC_PURCHASE', 'APPLICATION_USER', ?, 'SYSTEM', ?, 'COMPLETED', ?, ?)`,
      [
        randomUUID(),
        `COS-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`,
        `cosmetic:${input.clientRequestId}`,
        identity.userId,
        price,
        `${catalog.name} · ${validityDays} days`,
        JSON.stringify({ catalogId: catalog.id, itemId: catalog.gift_key, validityDays }),
      ],
    );
    await connection.execute(
      `INSERT INTO user_cosmetic_entitlements
        (id, application_user_id, gift_catalog_id, source, expires_at, equipped_at, grant_reference)
       VALUES (?, ?, ?, 'MALL', DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? DAY), ?, ?)`,
      [entitlementId, identity.userId, catalog.id, validityDays, equip ? new Date() : null, input.clientRequestId],
    );
    await connection.execute(
      "UPDATE cosmetic_purchase_requests SET entitlement_id = ?, status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
      [entitlementId, request.id],
    );
    const snapshot = await snapshotOnConnection(connection, identity.userId);
    return {
      ...snapshot,
      idempotent: false,
      entitlementId,
      chargedCoins: price,
      newBalance: Number(wallet.available_balance) - price,
    };
  });
}

export async function setCosmeticEquipped(
  identity: MobileIdentity,
  input: { entitlementId: string; equipped: boolean },
) {
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<EntitlementRow[]>(
      `SELECT entitlement.id entitlement_id, entitlement.source, entitlement.acquired_at,
              entitlement.expires_at, entitlement.equipped_at, entitlement.manually_unequipped_at,
              catalog.id, catalog.gift_key, catalog.name, catalog.catalog_type,
              catalog.coin_price, catalog.currency, catalog.validity_days,
              catalog.vip_tier_eligibility,
              catalog.visual_url, catalog.animation_key, catalog.asset_config,
              catalog.active
       FROM user_cosmetic_entitlements entitlement
       INNER JOIN gift_catalog catalog ON catalog.id = entitlement.gift_catalog_id
       WHERE entitlement.id = ? AND entitlement.application_user_id = ?
       LIMIT 1 FOR UPDATE`,
      [input.entitlementId, identity.userId],
    );
    const selected = rows[0];
    if (!selected) throw new Error("This item is not in your bag.");
    if (input.equipped) {
      if (!Boolean(selected.active)) throw new Error("This Mall item is no longer available.");
      if (new Date(selected.expires_at).getTime() <= Date.now()) throw new Error("This item has expired.");
      if (selected.source === "VIP") {
        const [vipRows] = await connection.query<(RowDataPacket & { vip_tier: number; vip_expires_at: Date | null })[]>(
          "SELECT vip_tier, vip_expires_at FROM application_users WHERE id = ? LIMIT 1 FOR UPDATE",
          [identity.userId],
        );
        const vip = vipRows[0];
        if (!vip?.vip_expires_at || new Date(vip.vip_expires_at).getTime() <= Date.now()
          || selected.vip_tier_eligibility == null
          || Number(selected.vip_tier_eligibility) > Number(vip.vip_tier)) {
          throw new Error("This VIP item is no longer available.");
        }
      }
      const type = presentationType(String(selected.catalog_type));
      await connection.execute(
        `UPDATE user_cosmetic_entitlements entitlement
         INNER JOIN gift_catalog catalog ON catalog.id = entitlement.gift_catalog_id
         SET entitlement.equipped_at = NULL
         WHERE entitlement.application_user_id = ? AND entitlement.equipped_at IS NOT NULL
           AND (CASE WHEN catalog.catalog_type = 'ENTRY_FRAME' THEN 'ENTRY_EFFECT' ELSE catalog.catalog_type END) = ?`,
        [identity.userId, type],
      );
      await connection.execute(
        "UPDATE user_cosmetic_entitlements SET equipped_at = CURRENT_TIMESTAMP(3), manually_unequipped_at = NULL WHERE id = ?",
        [selected.entitlement_id],
      );
    } else {
      await connection.execute(
        "UPDATE user_cosmetic_entitlements SET equipped_at = NULL, manually_unequipped_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
        [selected.entitlement_id],
      );
    }
    return snapshotOnConnection(connection, identity.userId);
  });
}
