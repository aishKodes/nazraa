"use client";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { publishStartupCampaign } from "@/app/media-product-actions";
import type { z } from "zod";
import type { startupCampaignSchema } from "@/lib/services/startup-campaign-policy";
export function StartupCampaignControls({campaign}: {campaign: z.infer<typeof startupCampaignSchema> | null}) {
  const [kind, setKind] = useState(campaign?.kind ?? "IMAGE");
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return <form action={publishStartupCampaign} className="form-grid">
    <label>Startup campaign<select name="enabled" defaultValue={String(campaign?.enabled ?? false)}><option value="false">Disabled</option><option value="true">Enabled</option></select></label>
    <label>Asset type<select name="kind" value={kind} onChange={(event) => {setKind(event.target.value as "IMAGE" | "VIDEO"); setPreview(null);}}><option value="IMAGE">Image</option><option value="VIDEO">Short muted video</option></select></label>
    <label>Display milliseconds<input name="durationMs" type="number" min="800" max="3000" defaultValue={campaign?.durationMs ?? 1500} required /></label>
    <label>Upload (2 MB maximum)<input key={kind} name="asset" type="file" accept={kind === "IMAGE" ? "image/png,image/jpeg,image/webp" : "video/mp4"} onChange={(event) => { const file = event.target.files?.[0]; setPreview(file ? URL.createObjectURL(file) : null); }} /></label>
    {(preview ?? campaign?.assetUrl) && <div className="span-two">{kind === "VIDEO" ? <video src={preview ?? campaign!.assetUrl} controls muted playsInline style={{maxHeight: 260, maxWidth: "100%"}} /> : <img src={preview ?? campaign!.assetUrl} alt="Startup creative preview" style={{maxHeight: 260, maxWidth: "100%", objectFit: "contain"}} />}</div>}
    <p className="span-two">Only cached media is shown at launch. Missing/corrupt files are skipped. Video must be H.264 MP4, 0.8–3 seconds, and is always muted.</p>
    <PublishButton />
  </form>;
}
function PublishButton() {
  const {pending} = useFormStatus();
  return <button className="primary-button" type="submit" disabled={pending}>{pending ? "Publishing…" : "Save / Publish"}</button>;
}
