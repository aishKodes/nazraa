import "server-only";
import sharp from "sharp";

export type PreparedPublicImage = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  data: Buffer;
  byteSize: number;
  originalName: string;
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
