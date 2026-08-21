"use client";

import { useEffect, useState } from "react";

export function GiftArtworkFields({
  currentEmoji,
  currentImageUrl,
  requireArtwork = false,
}: {
  currentEmoji?: string | null;
  currentImageUrl?: string | null;
  requireArtwork?: boolean;
}) {
  const [mode, setMode] = useState<"EMOJI" | "IMAGE">(currentImageUrl ? "IMAGE" : "EMOJI");
  const [emoji, setEmoji] = useState(currentEmoji ?? "🎁");
  const [preview, setPreview] = useState(currentImageUrl ?? "");
  const [objectUrl, setObjectUrl] = useState("");

  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  return <fieldset className="gift-artwork-fields">
    <legend>Gift artwork</legend>
    <div className="artwork-mode">
      <label><input type="radio" name="artworkMode" value="EMOJI" checked={mode === "EMOJI"} onChange={() => setMode("EMOJI")} />Emoji</label>
      <label><input type="radio" name="artworkMode" value="IMAGE" checked={mode === "IMAGE"} onChange={() => setMode("IMAGE")} />Upload picture</label>
    </div>
    {mode === "EMOJI" ? <label>Emoji
      <input name="emoji" value={emoji} onChange={(event) => setEmoji(event.target.value)} maxLength={16} required />
      <span className="emoji-preview" aria-label="Gift emoji preview">{emoji || "🎁"}</span>
    </label> : <label>Picture <span>JPG, PNG, animated WebP; up to 1 MB</span>
      <input
        name="image"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        required={requireArtwork && !currentImageUrl}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          const next = URL.createObjectURL(file);
          setObjectUrl(next);
          setPreview(next);
        }}
      />
      <span
        className={`image-upload-preview gift-preview${preview ? " has-image" : ""}`}
        style={preview ? { backgroundImage: `url(${JSON.stringify(preview)})` } : undefined}
      >{preview ? "" : "Choose gift artwork"}</span>
    </label>}
  </fieldset>;
}
