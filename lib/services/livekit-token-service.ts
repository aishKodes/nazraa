import "server-only";

import { SignJWT } from "jose";

export type LiveKitPublishMode = "none" | "audio_only" | "video_audio";

/**
 * Minimal server-side LiveKit token issuer. `jose` is already a production
 * dependency of Control, which keeps API credentials out of Flutter and
 * avoids adding a second JWT implementation just for the migration.
 */
export class LiveKitTokenService {
  constructor(
    private readonly url = process.env.LIVEKIT_URL?.trim() ?? "",
    private readonly apiKey = process.env.LIVEKIT_API_KEY?.trim() ?? "",
    private readonly apiSecret = process.env.LIVEKIT_API_SECRET?.trim() ?? "",
  ) {}

  get isConfigured() {
    return /^wss:\/\//i.test(this.url) && this.apiKey.length >= 4 && this.apiSecret.length >= 16;
  }

  async issueRoomToken(input: {
    roomId: string;
    identity: string;
    participantName: string;
    publishMode: LiveKitPublishMode;
    ttlSeconds?: number;
  }) {
    if (!this.isConfigured) {
      throw new Error("Live media is being prepared. Please retry shortly.");
    }
    const ttlSeconds = Math.max(300, Math.min(3600, input.ttlSeconds ?? 900));
    const now = Math.floor(Date.now() / 1000);
    const canPublish = input.publishMode !== "none";
    const canPublishSources = input.publishMode === "video_audio"
      ? ["camera", "microphone"]
      : input.publishMode === "audio_only"
        ? ["microphone"]
        : [];
    const token = await new SignJWT({
      name: input.participantName.slice(0, 128),
      video: {
        room: input.roomId,
        roomJoin: true,
        canSubscribe: true,
        canPublish,
        canPublishData: false,
        canPublishSources,
      },
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(this.apiKey)
      .setSubject(input.identity)
      .setIssuedAt(now)
      .setNotBefore(now - 5)
      .setExpirationTime(now + ttlSeconds)
      .sign(new TextEncoder().encode(this.apiSecret));
    return {
      serverUrl: this.url,
      participantToken: token,
      expiresAt: new Date((now + ttlSeconds) * 1000).toISOString(),
    };
  }
}
