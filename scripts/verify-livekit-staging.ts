import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { jwtVerify } from "jose";
import { WebhookEvent } from "livekit-server-sdk";

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === "server-only"
        ? "next/dist/compiled/server-only/empty.js"
        : specifier,
      context,
    );
  },
});

async function main() {
  const { LiveKitTokenService } = await import("@/lib/services/livekit-token-service");
  const { normalizeLiveKitWebhookEvent } = await import("@/lib/services/livekit-media-evidence");
  const secret = "local-livekit-staging-only-secret-2026";
  const issuer = "LK_NAZRAA_TEST";
  const tokenService = new LiveKitTokenService(
    "wss://rtc.example.test",
    issuer,
    secret,
  );
  const host = await tokenService.issueRoomToken({
    roomId: "NZAQA123",
    identity: "12000006",
    participantName: "Google Play Reviewer Host",
    publishMode: "video_audio",
    ttlSeconds: 900,
  });
  const hostClaims = await jwtVerify(host.participantToken, new TextEncoder().encode(secret), {
    algorithms: ["HS256"],
    issuer,
  });
  const hostVideo = hostClaims.payload.video as Record<string, unknown>;
  assert.equal(hostClaims.payload.sub, "12000006");
  assert.equal(hostVideo.room, "NZAQA123");
  assert.equal(hostVideo.canPublish, true);
  assert.deepEqual(hostVideo.canPublishSources, ["camera", "microphone"]);

  const viewer = await tokenService.issueRoomToken({
    roomId: "NZAQA123",
    identity: "12000007",
    participantName: "Google Play Reviewer Viewer",
    publishMode: "none",
  });
  const viewerClaims = await jwtVerify(viewer.participantToken, new TextEncoder().encode(secret), {
    algorithms: ["HS256"],
    issuer,
  });
  const viewerVideo = viewerClaims.payload.video as Record<string, unknown>;
  assert.equal(viewerVideo.canPublish, false);
  assert.deepEqual(viewerVideo.canPublishSources, []);

  const raw = JSON.stringify({
    id: "evt_lk_qa_1",
    event: "track_published",
    createdAt: 1_789_398_000,
    room: { name: "NZAQA123" },
    participant: { identity: "12000006" },
    track: { sid: "TR_qa_1", type: "VIDEO" },
  });
  const evidence = normalizeLiveKitWebhookEvent(JSON.parse(raw), raw);
  assert.ok(evidence);
  assert.equal(evidence.providerEventId, "evt_lk_qa_1");
  assert.equal(evidence.trackKind, "VIDEO");
  assert.equal(evidence.roomCode, "NZAQA123");
  assert.equal(evidence.occurredAt.getTime(), 1_789_398_000_000);
  // Protobuf JSON represents int64 timestamps as strings. Use the actual
  // provider SDK serializer, not a fixture that silently changes their type.
  const providerEvent = new WebhookEvent({
    id: "evt_lk_proto_qa",
    event: "track_published",
    createdAt: 1_789_398_000n,
    room: { name: "NZAQA123" },
    participant: { identity: "12000006" },
    track: { sid: "TR_qa_proto", type: 1 },
  });
  providerEvent.event = "track_published";
  const providerRaw = providerEvent.toJsonString();
  const providerJson = JSON.parse(providerRaw);
  assert.equal(typeof providerJson.createdAt, "string");
  const providerEvidence = normalizeLiveKitWebhookEvent(providerJson, providerRaw);
  assert.ok(providerEvidence);
  assert.equal(providerEvidence.occurredAt.getTime(), 1_789_398_000_000);
  const millisecondsRaw = JSON.stringify({ ...providerJson, createdAt: "1789398000000" });
  assert.equal(
    normalizeLiveKitWebhookEvent(JSON.parse(millisecondsRaw), millisecondsRaw)?.occurredAt.getTime(),
    1_789_398_000_000,
  );
  assert.equal(
    normalizeLiveKitWebhookEvent({ event: "track_published" }, raw),
    null,
  );
  console.log("PASS LiveKit staging: role-scoped, short-lived server JWTs and normalized provider media evidence");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "LiveKit staging test failed");
  process.exitCode = 1;
});
