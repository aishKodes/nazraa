"use client";

import { useEffect, useState } from "react";

export function GiftArtworkFields({
  currentEmoji,
  currentImageUrl,
  currentAnimationKey,
  currentEffectConfig,
  requireArtwork = false,
}: {
  currentEmoji?: string | null;
  currentImageUrl?: string | null;
  currentAnimationKey?: string | null;
  currentEffectConfig?: Record<string, unknown> | null;
  requireArtwork?: boolean;
}) {
  const [mode, setMode] = useState<"EMOJI" | "IMAGE">(currentImageUrl ? "IMAGE" : "EMOJI");
  const [emoji, setEmoji] = useState(currentEmoji ?? "🎁");
  const [preview, setPreview] = useState(currentImageUrl ?? "");
  const [objectUrl, setObjectUrl] = useState("");
  const [animationPreview, setAnimationPreview] = useState(currentAnimationKey ?? "");
  const [animationObjectUrl, setAnimationObjectUrl] = useState("");
  const [animationPreviewType, setAnimationPreviewType] = useState(
    String(currentEffectConfig?.assetType ?? "").toUpperCase(),
  );
  const config = currentEffectConfig ?? {};
  const configured = (key: string, fallback: string | number | boolean) =>
    String(config[key] ?? fallback);

  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (animationObjectUrl) URL.revokeObjectURL(animationObjectUrl);
  }, [objectUrl, animationObjectUrl]);

  return <fieldset className="gift-artwork-fields">
    <legend>Item artwork</legend>
    <div className="artwork-mode">
      <label><input type="radio" name="artworkMode" value="EMOJI" checked={mode === "EMOJI"} onChange={() => setMode("EMOJI")} />Emoji</label>
      <label><input type="radio" name="artworkMode" value="IMAGE" checked={mode === "IMAGE"} onChange={() => setMode("IMAGE")} />Upload picture</label>
    </div>
    {mode === "EMOJI" ? <label>Emoji
      <input name="emoji" value={emoji} onChange={(event) => setEmoji(event.target.value)} maxLength={16} required />
      <span className="emoji-preview" aria-label="Item emoji preview">{emoji || "🎁"}</span>
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
      >{preview ? "" : "Choose item artwork"}</span>
    </label>}
    <label>Animation <span>Lottie, animated WebP, MP4 or WebM; up to 3 MB</span>
      <input
        name="animation"
        type="file"
        accept="application/json,.json,image/webp,video/mp4,video/webm,.webm"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (animationObjectUrl) URL.revokeObjectURL(animationObjectUrl);
          const next = URL.createObjectURL(file);
          setAnimationObjectUrl(next);
          setAnimationPreview(next);
          setAnimationPreviewType(file.type.startsWith("video/") ? "VIDEO" : file.type === "image/webp" ? "ANIMATED_WEBP" : "LOTTIE");
        }}
      />
      {animationPreview ? <span className="effect-file-preview">
        {animationPreviewType === "VIDEO"
          ? <video src={animationPreview} controls muted playsInline preload="metadata" />
          : animationPreviewType === "ANIMATED_WEBP"
            ? <span role="img" aria-label="Animation preview" style={{ backgroundImage: `url(${JSON.stringify(animationPreview)})`, backgroundPosition: "center", backgroundRepeat: "no-repeat", backgroundSize: "contain", display: "block", minHeight: 180 }} />
            : <a href={animationPreview} target="_blank" rel="noreferrer">Open validated Lottie preview file</a>}
      </span> : null}
    </label>
    {currentAnimationKey ? <label className="checkbox-row">
      <input name="removeAnimation" type="checkbox" value="true" /> Remove current animation
    </label> : null}
    <label>Presentation tier
      <select name="presentationTier" defaultValue={configured("presentationTier", "MEDIUM").toUpperCase()}>
        <option value="SMALL">Small</option><option value="MEDIUM">Medium</option><option value="PREMIUM">Premium</option><option value="ULTRA">Ultra / special</option>
      </select>
    </label>
    <label>Default display
      <select name="displayMode" defaultValue={configured("displayMode", "AUTO").toUpperCase()}>
        <option value="AUTO">Automatic</option><option value="FULL">Full effect</option><option value="COMPACT">Compact notice</option><option value="SILENT">Visual only / silent</option><option value="SUPPRESSED">Suppressed</option>
      </select>
    </label>
    <label>Position
      <select name="position" defaultValue={configured("position", "CENTER").toUpperCase()}>
        <option value="TOP">Top</option><option value="CENTER">Center</option><option value="BOTTOM">Bottom</option><option value="RECIPIENT">Recipient</option><option value="FULL_SCREEN">Full-screen stage</option>
      </select>
    </label>
    <label>Duration (milliseconds)<input name="durationMs" type="number" min="250" max="8000" step="50" required defaultValue={configured("durationMs", 1800)} /></label>
    <label>Effect width <span>optional px</span><input name="effectWidth" type="number" min="1" max="1920" defaultValue={configured("width", "")} /></label>
    <label>Effect height <span>optional px</span><input name="effectHeight" type="number" min="1" max="1920" defaultValue={configured("height", "")} /></label>
    <label>Layer (z-index)<input name="zIndex" type="number" min="-100" max="100" required defaultValue={configured("zIndex", 0)} /></label>
    <label>Priority<input name="effectPriority" type="number" min="0" max="1000" required defaultValue={configured("priority", 200)} /></label>
    <label>During games
      <select name="gameBehavior" defaultValue={configured("gameBehavior", "COMPACT").toUpperCase()}><option value="COMPACT">Compact notice</option><option value="SILENT">Silent</option><option value="SUPPRESSED">Suppress</option></select>
    </label>
    <label>During room panels/modals
      <select name="modalBehavior" defaultValue={configured("modalBehavior", "COMPACT").toUpperCase()}><option value="COMPACT">Compact notice</option><option value="SILENT">Silent</option><option value="SUPPRESSED">Suppress</option></select>
    </label>
    <label>Playback
      <select name="loop" defaultValue={configured("loop", false)}><option value="false">Play once</option><option value="true">Loop within duration</option></select>
    </label>
    <label>Effect sound <span>optional MP3, OGG or M4A; up to 384 KB</span><input name="effectSound" type="file" accept="audio/mpeg,audio/ogg,audio/mp4,.mp3,.ogg,.m4a" /></label>
    <label>Sound volume <span>0–1</span><input name="soundVolume" type="number" min="0" max="1" step="0.05" required defaultValue={configured("soundVolume", .8)} /></label>
    {typeof config.soundUrl === "string" && config.soundUrl ? <label className="checkbox-row">
      <input name="removeSound" type="checkbox" value="true" /> Remove current sound
      <audio src={config.soundUrl} controls preload="none" aria-label="Current effect sound preview" />
    </label> : null}
  </fieldset>;
}
