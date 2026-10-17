"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/guard";
import { saveStartupCampaign } from "@/lib/db/repositories/startup-campaign";
import { withTransaction } from "@/lib/db/transaction";
import type { RowDataPacket } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { beautyControls, beautyPublicMappingDefaults, beautyPublicMapping } from "@/lib/services/beauty-policy";

function destination(kind: "error" | "success", message: string) { return `/dashboard/settings?${kind}=${encodeURIComponent(message)}`; }
export async function publishBeautyPolicy(formData: FormData) {
  const scope=await requirePermission("settings.manage");
  if(scope.account.role!=="MASTER") throw new Error("Forbidden.");
  let failure: string|undefined;
  try {
    const reason=z.string().trim().min(5).max(500).parse(formData.get("reason"));
    const tuning:Record<string,number>={};
    for(const key of Object.keys(beautyControls)) tuning[key]=z.coerce.number().finite().int().min(0).max(100).parse(formData.get(key) ?? NaN);
    const suppliedMapping:Record<string,number>={};
    for(const key of Object.keys(beautyPublicMappingDefaults)) {
      const raw=formData.get(`curve_${key}`);
      // Older open Control tabs may submit only the existing 18 controls.
      if(raw!==null) suppliedMapping[key]=z.coerce.number().finite().min(key.endsWith("Exponent")?.5:0).max(key.endsWith("Exponent")?3:1).parse(raw);
    }
    await withTransaction(async connection=>{
      const [rows]=await connection.query<RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key='mobile.room_features' FOR UPDATE");
      const raw=rows[0]?.setting_value;
      const current=(typeof raw==="string"?JSON.parse(raw):raw??{}) as Record<string,unknown>;
      const mapping={...beautyPublicMapping(current.naturalBeautyPublicMapping),...suppliedMapping};
      const next={...current,naturalBeautyTuning:tuning,naturalBeautyPublicMapping:mapping,naturalBeautyTuningVersion:randomUUID()};
      await connection.execute(`INSERT INTO system_settings(setting_key,setting_value,updated_by) VALUES('mobile.room_features',?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_by=VALUES(updated_by)`,[JSON.stringify(next),scope.account.id]);
      await connection.execute(`INSERT INTO audit_logs(id,actor_account_id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason) VALUES(?,?,'MASTER','BEAUTY_TUNING_UPDATE','settings','MEDIA_POLICY','beauty',?,?,?)`,
        [randomUUID(),scope.account.id,JSON.stringify({tuning:current.naturalBeautyTuning,publicMapping:current.naturalBeautyPublicMapping}),JSON.stringify({tuning,publicMapping:mapping}),reason]);
    });
  } catch { failure="Check the beauty controls (0–100) and change reason."; }
  revalidatePath("/dashboard/settings");
  redirect(destination(failure?"error":"success",failure??"Device-local beauty tuning saved. Live sessions are not restarted."));
}
export async function publishStartupCampaign(formData: FormData) {
  const scope = await requirePermission("settings.manage");
  if (scope.account.role !== "MASTER") throw new Error("Forbidden.");
  let failure: string | undefined;
  try {
    const parsed = z.object({enabled: z.enum(["true", "false"]), durationMs: z.coerce.number().int().min(800).max(3000), kind: z.enum(["IMAGE", "VIDEO"])}).parse(Object.fromEntries(formData));
    const file = formData.get("asset");
    await saveStartupCampaign(scope, {...parsed, enabled: parsed.enabled === "true", file: file instanceof File && file.size ? file : undefined});
  } catch (error) { failure = error instanceof z.ZodError ? "Choose a valid startup duration and asset type." : error instanceof Error ? error.message : "Startup media could not be published."; }
  revalidatePath("/dashboard/settings");
  redirect(destination(failure ? "error" : "success", failure ?? "Cached startup campaign published."));
}
export async function publishFaceQuality(formData: FormData) {
  const scope = await requirePermission("settings.manage");
  if (scope.account.role !== "MASTER") throw new Error("Forbidden.");
  let failure: string | undefined;
  try {
    const parsed = z.object({enabled: z.enum(["true", "false"]), codec: z.enum(["AUTO", "VP8", "H264"]),
      highBitrate: z.coerce.number().int().min(2400000).max(3500000),
      mediumBitrate: z.coerce.number().int().min(2000000).max(2800000),
      lowBitrate: z.coerce.number().int().min(800000).max(2000000),
      highFps: z.coerce.number().int().min(24).max(30), mediumFps: z.coerce.number().int().min(20).max(30),
      reason: z.string().trim().min(5).max(500),
      beautyScale: z.coerce.number().min(0).max(1.4),
      audioRoomLayoutV2: z.enum(["true", "false"]).default("true"),
    }).parse(Object.fromEntries(formData));
    if (parsed.mediumBitrate > parsed.highBitrate || parsed.lowBitrate > parsed.mediumBitrate) throw new Error("Quality bitrate limits must increase from LOW to HIGH.");
    await withTransaction(async (connection) => {
      const [rows] = await connection.query<RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key='mobile.room_features' FOR UPDATE");
      const raw = rows[0]?.setting_value;
      const current = (typeof raw === "string" ? JSON.parse(raw) : raw ?? {}) as Record<string, unknown>;
      const {reason, beautyScale, audioRoomLayoutV2, ...quality} = parsed;
      const next = {...current, audioRoomLayoutV2: audioRoomLayoutV2 === "true", faceQuality: {...quality, enabled: parsed.enabled === "true", version: randomUUID()}, naturalBeautyScale: beautyScale};
      await connection.execute(`INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES ('mobile.room_features', ?, ?)
        ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value), updated_by=VALUES(updated_by)`, [JSON.stringify(next), scope.account.id]);
      await connection.execute(`INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, previous_data, new_data, reason)
        VALUES (?, ?, 'MASTER', 'FACE_QUALITY_UPDATE', 'settings', 'MEDIA_POLICY', 'face', ?, ?, ?)`,
        [randomUUID(), scope.account.id, JSON.stringify({faceQuality: current.faceQuality, naturalBeautyScale: current.naturalBeautyScale}), JSON.stringify({faceQuality: next.faceQuality, naturalBeautyScale: next.naturalBeautyScale}), reason]);
    });
  } catch (error) { failure = error instanceof z.ZodError ? "Check the quality values and change reason." : error instanceof Error ? error.message : "Media quality could not be saved."; }
  revalidatePath("/dashboard/settings");
  redirect(destination(failure ? "error" : "success", failure ?? "Face quality saved; current rooms stay connected, new joins use the updated policy."));
}
