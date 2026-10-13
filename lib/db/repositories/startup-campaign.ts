import "server-only";
import { randomUUID, createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { Scope } from "@/types/platform";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { publicApiOrigin } from "@/lib/config/public-api-origin";
import { preparePublicImage, preparePublicEffect } from "@/lib/security/public-images";
import { startupCampaignSchema, validateStartupMp4 } from "@/lib/services/startup-campaign-policy";

export async function getStartupCampaign() {
  const [rows] = await db().query<RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.startup_campaign'");
  const raw = rows[0]?.setting_value;
  try {
    const parsed = startupCampaignSchema.safeParse(typeof raw === "string" ? JSON.parse(raw) : raw);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
export async function saveStartupCampaign(scope: Scope, input: { enabled: boolean; durationMs: number; kind: "IMAGE" | "VIDEO"; file?: File }) {
  if (scope.account.role !== "MASTER") throw new Error("Only Master may publish a startup campaign.");
  if (!Number.isInteger(input.durationMs) || input.durationMs < 800 || input.durationMs > 3000) throw new Error("Choose a duration from 0.8 to 3 seconds.");
  const previous = await getStartupCampaign();
  if (!input.enabled && !previous && !input.file?.size) return null;
  let assetId = previous?.assetId;
  let asset = null;
  if (input.file?.size) {
    if (input.kind === "VIDEO") {
      asset = await preparePublicEffect(input.file, 2 * 1024 * 1024, "Startup video");
      if (asset.mimeType !== "video/mp4") throw new Error("Use H.264 MP4 for startup videos.");
      validateStartupMp4(asset.data);
    } else {
      asset = await preparePublicImage(input.file, 1536 * 1024, "Startup image", {maxWidth: 1080, maxHeight: 1920});
    }
    assetId = randomUUID();
  }
  if (!assetId || (!asset && previous?.kind !== input.kind)) throw new Error("Choose an image or short video to publish.");
  const next = startupCampaignSchema.parse({ ...previous,
    enabled: input.enabled, durationMs: input.durationMs, kind: input.kind,
    version: randomUUID(), assetId,
    checksum: asset ? createHash("sha256").update(asset.data).digest("hex") : previous?.checksum,
    byteSize: asset?.byteSize ?? previous?.byteSize,
    assetUrl: `${publicApiOrigin()}/api/v1/assets/startup/${assetId}`,
    publishedAt: new Date().toISOString() });
  await withTransaction(async (connection) => {
    if (asset) await connection.execute(`INSERT INTO startup_campaign_assets (id, mime_type, image_data, byte_size, original_name, uploaded_by, checksum_sha256) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [assetId, asset.mimeType, asset.data, asset.byteSize, asset.originalName, scope.account.id, next.checksum]);
    await connection.execute(`INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES ('mobile.startup_campaign', ?, ?)
      ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value), updated_by=VALUES(updated_by)`, [JSON.stringify(next), scope.account.id]);
    await connection.execute(`INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, previous_data, new_data, reason)
      VALUES (?, ?, 'MASTER', 'STARTUP_CAMPAIGN_PUBLISH', 'settings', 'CAMPAIGN', ?, ?, ?, 'Updated brief cached startup creative')`,
      [randomUUID(), scope.account.id, next.version, JSON.stringify(previous), JSON.stringify(next)]);
  });
  return next;
}
