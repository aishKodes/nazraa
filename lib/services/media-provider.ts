import "server-only";

import type { MobileIdentity } from "@/lib/auth/mobile-session";

/** The media provider is a server-owned deployment decision. */
export type MediaProvider = "ZEGO" | "LIVEKIT";

function configuredProvider(): MediaProvider {
  return process.env.MEDIA_PROVIDER?.trim().toUpperCase() === "LIVEKIT"
    ? "LIVEKIT"
    : "ZEGO";
}

/**
 * A LIVEKIT deployment is global.  In particular, never fall back to ZEGO
 * merely because a LiveKit secret has been misconfigured: ZEGO may be
 * suspended, and an accidental fallback would make a valid room appear to
 * start while its media path is unavailable.  Token issuance performs the
 * configuration check and returns the normal sanitized retry state instead.
 *
 * The identity argument remains for source compatibility with callers and
 * historical staged-rollout records; it deliberately no longer gates media.
 */
export function mediaProviderFor(identity?: Pick<MobileIdentity, "playReviewerAccessOverride">): MediaProvider {
  // Keep the stable call signature while making the absence of identity-based
  // routing explicit to TypeScript and to future readers.
  void identity;
  const provider = configuredProvider();
  return provider === "LIVEKIT" ? "LIVEKIT" : "ZEGO";
}

export function isLiveKitConfigured() {
  const url = process.env.LIVEKIT_URL?.trim() ?? "";
  const key = process.env.LIVEKIT_API_KEY?.trim() ?? "";
  const secret = process.env.LIVEKIT_API_SECRET?.trim() ?? "";
  return /^wss:\/\//i.test(url) && key.length >= 4 && secret.length >= 16;
}

/** Used only for non-sensitive health/configuration responses. */
export function liveKitPublicUrl() {
  return process.env.LIVEKIT_URL?.trim() ?? "";
}
