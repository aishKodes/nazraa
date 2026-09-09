import "server-only";
import sharp from "sharp";

export type PreparedPublicImage = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  data: Buffer;
  byteSize: number;
  originalName: string;
};

export type PreparedPublicAnimation = {
  mimeType: "application/json";
  data: Buffer;
  byteSize: number;
  originalName: string;
};

export type PreparedPublicEffect = {
  mimeType: "application/json" | "image/webp" | "video/mp4" | "video/webm";
  data: Buffer;
  byteSize: number;
  originalName: string;
  extension: "json" | "webp" | "mp4" | "webm";
  assetType: "LOTTIE" | "ANIMATED_WEBP" | "VIDEO";
};

export type PreparedPublicSound = {
  mimeType: "audio/mpeg" | "audio/ogg" | "audio/mp4";
  data: Buffer;
  byteSize: number;
  originalName: string;
  extension: "mp3" | "ogg" | "m4a";
};

function detectedMime(data: Buffer): PreparedPublicImage["mimeType"] | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function preparePublicImage(
  file: File,
  maxBytes: number,
  label: string,
  options: { maxWidth: number; maxHeight: number; animated?: boolean },
): Promise<PreparedPublicImage> {
  if (!file.size) throw new Error(`Choose a ${label.toLowerCase()} image.`);
  if (file.size > maxBytes) throw new Error(`${label} must be ${(maxBytes / 1024 / 1024).toFixed(1).replace(".0", "")} MB or smaller.`);
  const data = Buffer.from(await file.arrayBuffer());
  const mimeType = detectedMime(data);
  if (!mimeType || mimeType !== file.type) throw new Error(`${label} must be an unmodified JPG, PNG, or WebP image.`);
  const optimized = await sharp(data, { animated: options.animated ?? false, limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: options.maxWidth, height: options.maxHeight, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
  if (optimized.length > maxBytes) throw new Error(`${label} remains too large after optimization. Choose a smaller image.`);
  return {
    mimeType: "image/webp",
    data: optimized,
    byteSize: optimized.length,
    originalName: `${file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 246) || "image"}.webp`,
  };
}

export async function publicImageFromDataUrl(
  value: string,
  maxBytes: number,
  label: string,
  options: { maxWidth: number; maxHeight: number } = { maxWidth: 1600, maxHeight: 1600 },
): Promise<PreparedPublicImage> {
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error(`${label} must be a JPG, PNG, or WebP image.`);
  const data = Buffer.from(match[2], "base64");
  if (!data.length || data.length > Math.max(maxBytes * 4, 8 * 1024 * 1024)) throw new Error(`${label} is too large.`);
  const mimeType = detectedMime(data);
  if (!mimeType || mimeType !== match[1]) throw new Error(`${label} image data is invalid.`);
  const optimized = await sharp(data, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: options.maxWidth, height: options.maxHeight, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
  if (optimized.length === 0 || optimized.length > maxBytes) {
    throw new Error(`${label} remains too large after optimization. Choose a smaller image.`);
  }
  return { mimeType: "image/webp", data: optimized, byteSize: optimized.length, originalName: "mobile-upload.webp" };
}

/** Validate a self-contained Lottie before it reaches the public asset CDN. */
export async function preparePublicLottie(
  file: File,
  maxBytes = 512 * 1024,
  label = "Animation",
): Promise<PreparedPublicAnimation> {
  if (!file.size) throw new Error(`Choose a ${label.toLowerCase()} file.`);
  if (file.size > maxBytes) throw new Error(`${label} must be ${(maxBytes / 1024).toFixed(0)} KB or smaller.`);
  if (!file.name.toLowerCase().endsWith(".json") || !["application/json", "text/json", ""].includes(file.type)) {
    throw new Error(`${label} must be a Lottie JSON file.`);
  }
  const source = Buffer.from(await file.arrayBuffer());
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(source.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error(`${label} contains invalid JSON.`);
  }
  const width = Number(value.w);
  const height = Number(value.h);
  const frameRate = Number(value.fr);
  const firstFrame = Number(value.ip ?? 0);
  const lastFrame = Number(value.op);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 1920 || height > 1920
    || !Number.isFinite(frameRate) || frameRate < 1 || frameRate > 60
    || !Number.isFinite(firstFrame) || !Number.isFinite(lastFrame) || lastFrame <= firstFrame
    || (lastFrame - firstFrame) / frameRate > 6
    || !Array.isArray(value.layers)) {
    throw new Error(`${label} must be a valid Lottie up to 1920×1920, 60 fps and 6 seconds.`);
  }
  const assets = Array.isArray(value.assets) ? value.assets : [];
  const hasExternalAsset = assets.some((asset) => {
    if (!asset || typeof asset !== "object") return false;
    const entry = asset as Record<string, unknown>;
    return [entry.u, entry.p].some((part) => typeof part === "string" && /^(?:https?:)?\/\//i.test(part));
  });
  if (hasExternalAsset) throw new Error(`${label} must be self-contained and cannot load external URLs.`);
  const data = Buffer.from(JSON.stringify(value));
  return {
    mimeType: "application/json",
    data,
    byteSize: data.length,
    originalName: `${file.name.replace(/\.json$/i, "").replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 246) || "animation"}.json`,
  };
}

function safeStem(name: string, fallback: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .slice(0, 246) || fallback;
}

/**
 * Validate an operator-uploaded effect without pretending every animation is
 * Lottie. Animated WebP remains the transparent raster option. MP4/WebM are
 * intentionally treated as bounded cinematic cards: alpha-video support is
 * not assumed until it has passed the real-device matrix.
 */
export async function preparePublicEffect(
  file: File,
  maxBytes = 3 * 1024 * 1024,
  label = "Effect animation",
): Promise<PreparedPublicEffect> {
  if (!file.size) throw new Error(`Choose a ${label.toLowerCase()} file.`);
  if (file.size > maxBytes) throw new Error(`${label} must be ${(maxBytes / 1024 / 1024).toFixed(1).replace(".0", "")} MB or smaller.`);
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".json")) {
    const lottie = await preparePublicLottie(file, Math.min(maxBytes, 512 * 1024), label);
    return { ...lottie, extension: "json", assetType: "LOTTIE" };
  }

  const data = Buffer.from(await file.arrayBuffer());
  if (lowerName.endsWith(".webp")) {
    if (file.type !== "image/webp" || detectedMime(data) !== "image/webp") {
      throw new Error(`${label} WebP data is invalid.`);
    }
    const metadata = await sharp(data, { animated: true, limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.width || !metadata.height || metadata.width > 1920 || metadata.height > 1920) {
      throw new Error(`${label} WebP must be no larger than 1920×1920.`);
    }
    return {
      mimeType: "image/webp",
      data,
      byteSize: data.length,
      originalName: `${safeStem(file.name, "effect")}.webp`,
      extension: "webp",
      assetType: "ANIMATED_WEBP",
    };
  }

  if (lowerName.endsWith(".mp4")) {
    const valid = data.length >= 12 && data.subarray(4, 8).toString("ascii") === "ftyp";
    if (!valid || !["video/mp4", "application/mp4", ""].includes(file.type)) {
      throw new Error(`${label} MP4 data is invalid.`);
    }
    return {
      mimeType: "video/mp4",
      data,
      byteSize: data.length,
      originalName: `${safeStem(file.name, "effect")}.mp4`,
      extension: "mp4",
      assetType: "VIDEO",
    };
  }

  if (lowerName.endsWith(".webm")) {
    const valid = data.length >= 4 && data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    if (!valid || !["video/webm", ""].includes(file.type)) {
      throw new Error(`${label} WebM data is invalid.`);
    }
    return {
      mimeType: "video/webm",
      data,
      byteSize: data.length,
      originalName: `${safeStem(file.name, "effect")}.webm`,
      extension: "webm",
      assetType: "VIDEO",
    };
  }

  throw new Error(`${label} must be Lottie JSON, animated WebP, MP4, or WebM.`);
}

/** Validate a short optional sound paired with a visual effect. */
export async function preparePublicSound(
  file: File,
  maxBytes = 384 * 1024,
  label = "Effect sound",
): Promise<PreparedPublicSound> {
  if (!file.size) throw new Error(`Choose a ${label.toLowerCase()} file.`);
  if (file.size > maxBytes) throw new Error(`${label} must be ${(maxBytes / 1024).toFixed(0)} KB or smaller.`);
  const data = Buffer.from(await file.arrayBuffer());
  const lowerName = file.name.toLowerCase();
  const mp3 = lowerName.endsWith(".mp3")
    && ["audio/mpeg", "audio/mp3", ""].includes(file.type)
    && (data.subarray(0, 3).toString("ascii") === "ID3" || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0));
  const ogg = lowerName.endsWith(".ogg")
    && ["audio/ogg", "application/ogg", ""].includes(file.type)
    && data.subarray(0, 4).toString("ascii") === "OggS";
  const m4a = lowerName.endsWith(".m4a")
    && ["audio/mp4", "audio/x-m4a", ""].includes(file.type)
    && data.length >= 12 && data.subarray(4, 8).toString("ascii") === "ftyp";
  if (!mp3 && !ogg && !m4a) throw new Error(`${label} must be an unmodified MP3, OGG, or M4A file.`);
  const extension = mp3 ? "mp3" : ogg ? "ogg" : "m4a";
  const mimeType = mp3 ? "audio/mpeg" : ogg ? "audio/ogg" : "audio/mp4";
  return {
    mimeType,
    data,
    byteSize: data.length,
    originalName: `${safeStem(file.name, "effect-sound")}.${extension}`,
    extension,
  };
}
