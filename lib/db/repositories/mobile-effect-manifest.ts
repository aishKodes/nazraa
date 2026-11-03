import "server-only";

import { createHash } from "crypto";
import type { RowDataPacket } from "mysql2/promise";

import { currentPublicAssetUrl } from "@/lib/config/public-api-origin";
import { db } from "@/lib/db/pool";
import {premiumRoleManifestRows} from "./premium-role-visuals";

type CatalogRow = RowDataPacket & {
  gift_key: string;
  name: string;
  category: string;
  catalog_type: string;
  visual_url: string | null;
  animation_key: string | null;
  asset_config: string | Record<string, unknown> | null;
  updated_at: string | Date;
};
type AssetRow = RowDataPacket & {
  id: string;
  byte_size: number;
  checksum_sha256: string;
  mime_type: string;
};

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function assetId(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    const match = /\/api\/v1\/assets\/gifts\/([0-9a-f-]{36})(?:\.[a-z0-9]+)?$/i.exec(url.pathname);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/**
 * Small, authenticated, versioned manifest for room effects. It contains no
 * blobs: visual/audio bytes remain immutable cacheable asset URLs.  The
 * Flutter renderer merges this onto its bootstrap catalogue so Control can
 * replace an effect without an APK release.
 */
export async function mobileEffectManifest() {
  const [rows] = await db().query<CatalogRow[]>(
    `SELECT gift_key, name, category, catalog_type, visual_url, animation_key,
            asset_config, updated_at
       FROM gift_catalog
      WHERE active = TRUE
      ORDER BY catalog_type, sort_order, coin_price, name`,
  );
  const roleRows=await premiumRoleManifestRows();
  const configRows = [...rows,...roleRows as unknown as CatalogRow[]].map((row) => ({ row, config: object(row.asset_config) }));
  const assetIds = new Set<string>();
  for (const { row, config } of configRows) {
    for (const value of [row.visual_url, row.animation_key, config.assetUrl, config.previewUrl, config.soundUrl]) {
      const id = assetId(value);
      if (id) assetIds.add(id);
    }
  }
  const assetMap = new Map<string, AssetRow>();
  if (assetIds.size) {
    const ids = [...assetIds];
    const [assets] = await db().query<AssetRow[]>(
      `SELECT id, byte_size, checksum_sha256, mime_type
         FROM gift_assets
        WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    for (const asset of assets) assetMap.set(asset.id.toLowerCase(), asset);
  }

  const effects = configRows.map(({ row, config }) => {
    const previewUrl = currentPublicAssetUrl(row.visual_url);
    const animationUrl = currentPublicAssetUrl(row.animation_key);
    const configuredSound = currentPublicAssetUrl(
      typeof config.soundUrl === "string" ? config.soundUrl : null,
    );
    const primaryUrl = animationUrl ?? previewUrl;
    const primary = assetMap.get(assetId(primaryUrl) ?? "");
    const preview = assetMap.get(assetId(previewUrl) ?? "");
    const sound = assetMap.get(assetId(configuredSound) ?? "");
    return {
      id: row.gift_key,
      name: row.name,
      category: row.category,
      catalogType: row.catalog_type,
      updatedAt: row.updated_at,
      assetConfig: {
        ...config,
        portraitScale:typeof config.portraitScale==='number'?config.portraitScale:null,
        portraitOffsetY:typeof config.portraitOffsetY==='number'?config.portraitOffsetY:null,
        enabled:typeof config.enabled==='boolean'?config.enabled:true,
        displayClass:typeof config.displayClass==='string'?config.displayClass:null,
        finishingStyle:typeof config.finishingStyle==='string'?config.finishingStyle:null,
        assetType: typeof config.assetType==='string'?config.assetType:null,
        // Only validated, Control-owned video blobs get this permission. The
        // mobile renderer keeps all opaque video inside a bounded surface.
        ...(primary && ['video/mp4','video/webm'].includes(primary.mime_type)?{
          assetType:'VIDEO',videoPresentation:'BOUNDED_CINEMATIC',displayRegion:'LOWER_VIDEO',position:'BOTTOM',
        }:{}),
        assetUrl: primaryUrl,
        previewUrl,
        fallbackVisualUrl: previewUrl,
        soundUrl: configuredSound,
        assetVersion: String(config.assetVersion ?? primary?.checksum_sha256 ?? row.updated_at),
        // Keep the rollout gate explicit in the wire schema.  Spreading the
        // untyped JSON config alone makes this field invisible to typed
        // consumers even though Control persists it.
        minimumAppVersion:
          typeof config.minimumAppVersion === "string"
            ? config.minimumAppVersion
            : null,
        assetChecksum: primary?.checksum_sha256 ?? config.assetChecksum ?? null,
        assetByteSize: primary?.byte_size ?? config.assetByteSize ?? null,
        previewChecksum: preview?.checksum_sha256 ?? config.previewChecksum ?? null,
        soundChecksum: sound?.checksum_sha256 ?? config.soundChecksum ?? null,
        soundByteSize: sound?.byte_size ?? config.soundByteSize ?? null,
      },
    };
  });
  const manifestVersion = createHash("sha256")
    .update(JSON.stringify(effects))
    .digest("hex")
    .slice(0, 20);
  return { manifestVersion, effects };
}
