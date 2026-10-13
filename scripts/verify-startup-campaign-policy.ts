import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startupCampaignSchema, validateStartupMp4 } from "../lib/services/startup-campaign-policy";

function atom(type: string, body: Buffer) {
  const result = Buffer.alloc(8 + body.length);
  result.writeUInt32BE(result.length); result.write(type, 4); body.copy(result, 8); return result;
}
const movieHeader = Buffer.alloc(24);
movieHeader.writeUInt32BE(1000, 12); movieHeader.writeUInt32BE(1500, 16);
const sampleDescription = Buffer.alloc(94);
sampleDescription.writeUInt32BE(1, 4); sampleDescription.writeUInt32BE(86, 8); sampleDescription.write("avc1", 12);
sampleDescription.writeUInt16BE(720, 40); sampleDescription.writeUInt16BE(1280, 42);
const valid = Buffer.concat([atom("moov", Buffer.concat([atom("mvhd", movieHeader), atom("trak", atom("mdia", atom("minf", atom("stbl", atom("stsd", sampleDescription)))))])), atom("mdat",Buffer.from([0,1,2,3]))]);
assert.equal(validateStartupMp4(valid), 1.5);
assert.throws(() => validateStartupMp4(Buffer.from("not a video")));
const longHeader = Buffer.from(movieHeader); longHeader.writeUInt32BE(15000, 16);
assert.throws(() => validateStartupMp4(atom("moov", Buffer.concat([atom("mvhd", longHeader), atom("stsd", sampleDescription)]))), /0.8 and 3 seconds/);
const config = {enabled: true, durationMs: 1500, kind: "VIDEO", version: randomUUID(), assetId: randomUUID(), checksum: "a".repeat(64), byteSize: 512, assetUrl: "https://api.nazraa.pixtra.site/api/v1/assets/startup/qa", publishedAt: new Date().toISOString()};
assert(startupCampaignSchema.safeParse(config).success);
for (const bad of [{...config, durationMs: 5000}, {...config, byteSize: 50000000}, {...config, kind: "HTML"}, {...config, checksum: "wrong"}]) assert(!startupCampaignSchema.safeParse(bad).success);
console.log("PASS startup campaign: strict metadata, bounded atom parser, H.264/video duration validation, malformed/oversized/unsupported rejection");
