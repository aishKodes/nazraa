import { z } from "zod";

export const startupCampaignSchema = z.object({
  enabled: z.boolean(), durationMs: z.number().int().min(800).max(3000),
  kind: z.enum(["IMAGE", "VIDEO"]), version: z.string().uuid(),
  assetId: z.string().uuid(), checksum: z.string().regex(/^[a-f0-9]{64}$/),
  byteSize: z.number().int().min(1).max(2 * 1024 * 1024),
  assetUrl: z.string().url(), publishedAt: z.string().datetime(),
});

/** Bounded MP4 atom parsing, not trusting a filename or MIME header. */
export function validateStartupMp4(data: Buffer) {
  if (data.length > 2 * 1024 * 1024) throw new Error("Startup videos must be 2 MB or smaller.");
  let duration = 0, h264 = false, movie = false, media = false;
  function visit(start: number, end: number, depth: number) {
    if (depth > 8) throw new Error("The startup video could not be processed.");
    for (let offset = start; offset + 8 <= end;) {
      const size = data.readUInt32BE(offset), type = data.toString("ascii", offset + 4, offset + 8);
      if (size < 8 || offset + size > end) throw new Error("The startup video is malformed.");
      const body = offset + 8;
      if (type === "moov") movie = true;
      if (type === "mdat" && size > 8) media = true;
      if (["moov", "trak", "mdia", "minf", "stbl"].includes(type)) visit(body, offset + size, depth + 1);
      if (type === "mvhd") {
        const long = data[body] === 1;
        const timeOffset = body + (long ? 20 : 12), durationOffset = timeOffset + 4;
        if (durationOffset + (long ? 8 : 4) > offset + size) throw new Error("Video duration is missing.");
        const scale = data.readUInt32BE(timeOffset);
        duration = Number(long ? data.readBigUInt64BE(durationOffset) : data.readUInt32BE(durationOffset)) / scale;
      }
      if (type === "stsd" && body + 16 <= offset + size) {
        // First sample description is the actual video codec, not arbitrary payload bytes.
        if (data.toString("ascii", body + 12, body + 16) === "avc1") {
          if (body + 44 > offset + size) throw new Error("Video dimensions are missing.");
          const width = data.readUInt16BE(body + 40), height = data.readUInt16BE(body + 42);
          if (!width || !height || width > 1920 || height > 1920 || width * height > 2073600) {
            throw new Error("Use a startup video at 1080p or smaller.");
          }
          h264 = true;
        }
      }
      offset += size;
    }
  }
  visit(0, data.length, 0);
  if (!movie || !media || !h264 || !Number.isFinite(duration) || duration < .8 || duration > 3.05) {
    throw new Error("Use an optimized H.264 MP4 between 0.8 and 3 seconds.");
  }
  return duration;
}
