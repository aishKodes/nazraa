import "server-only";

import { createHash } from "crypto";

const DEFAULT_PLAYBACK_HOST = "play-ws1.live.pixtra.site";
const DEFAULT_TTL_SECONDS = 3_600;

export type ZegoCdnPlaybackProtocol = "hls" | "flv";

function canonicalPlaybackUrl(streamId: string, protocol: ZegoCdnPlaybackProtocol) {
  const encodedStreamId = encodeURIComponent(streamId);
  return protocol === "flv"
    ? `https://${DEFAULT_PLAYBACK_HOST}/live/${encodedStreamId}.flv`
    : `https://${DEFAULT_PLAYBACK_HOST}/live/${encodedStreamId}/playlist.m3u8`;
}

function playbackKeyState() {
  const key = process.env.ZEGO_CDN_PLAYBACK_PRIMARY_KEY?.trim() ?? "";
  // ZEGO's playback-auth console accepts provider-generated keys rather than
  // an application-defined character set. In particular, some valid keys are
  // longer than 32 characters or contain URL-safe punctuation. Treat the key
  // as an opaque server secret and reject only unsafe/unusable values; it is
  // never returned to Flutter or the Control frontend.
  if (!key) return { key: null, state: "missing" as const };
  if (key.length < 6) return { key: null, state: "tooShort" as const };
  if (key.length > 512) return { key: null, state: "tooLong" as const };
  if (/\s/.test(key)) return { key: null, state: "whitespace" as const };
  return { key, state: "configured" as const };
}

function playbackKey() {
  return playbackKeyState().key;
}

function safeTtlSeconds() {
  const configured = Number(process.env.ZEGO_CDN_PLAYBACK_URL_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);
  return Number.isFinite(configured)
    ? Math.max(300, Math.min(7_200, Math.trunc(configured)))
    : DEFAULT_TTL_SECONDS;
}

/**
 * Generates Wangsu/ZEGO play-auth URLs without exposing either authentication
 * key to Flutter. Stream-publishing auth signs `/live/{streamId}`, but
 * stream-playing auth signs the exact resource path: for HLS that is
 * `/live/{streamId}/playlist.m3u8`. Signing only the stream base works for
 * publishing but produces a 403 when the CDN receives an HLS pull request.
 */
export function signedZegoCdnPlaybackUrl(
  streamId: string,
  inputUrl?: string | null,
  protocolOrNow: ZegoCdnPlaybackProtocol | Date = "hls",
  requestedNow?: Date,
) {
  // Keep the original third-argument Date form working for diagnostics and
  // verification scripts while allowing production to select the resource
  // protocol explicitly.
  const protocol: ZegoCdnPlaybackProtocol = typeof protocolOrNow === "string"
    ? protocolOrNow
    : "hls";
  const now = protocolOrNow instanceof Date ? protocolOrNow : requestedNow ?? new Date();
  const key = playbackKey();
  if (!key || !/^[A-Za-z0-9_-]{1,256}$/.test(streamId)) return null;

  const fallback = canonicalPlaybackUrl(streamId, protocol);
  const canonical = new URL(fallback);
  let url = canonical;
  try {
    const candidate = new URL(inputUrl?.trim() || fallback);
    // A provider response is only useful when it already points at the same
    // branded host *and* the selected protocol's exact resource. Otherwise
    // use our canonical endpoint; signing an HLS playlist as FLV would cause
    // the CDN to reject the request.
    if (candidate.hostname === DEFAULT_PLAYBACK_HOST && candidate.pathname === canonical.pathname) {
      url = candidate;
    }
  } catch {
    // The canonical branded URL remains safe and signs the selected resource.
  }
  // StartMix may return ZEGO's default endpoint even after our branded CNAME
  // is configured. Never sign or expose that provider hostname. Use the
  // verified Nazraa playback domain instead, preserving only an already
  // branded URL supplied by the mixer.
  if (url.hostname !== DEFAULT_PLAYBACK_HOST || url.pathname !== canonical.pathname) url = canonical;
  url.protocol = "https:";

  const expiresAt = Math.floor(now.getTime() / 1_000) + safeTtlSeconds();
  const wsABStime = expiresAt.toString(16).toUpperCase();
  // The Stream Playing signature covers the exact resource path. HLS signs
  // its playlist; FLV signs its progressive `.flv` resource. In both cases
  // only the verified branded host is exposed to the application.
  const streamName = url.pathname;
  const wsSecret = createHash("md5")
    .update(`${wsABStime}${streamName}${key}`)
    .digest("hex");
  url.search = new URLSearchParams({ wsSecret, wsABStime }).toString();
  return url.toString();
}

export function zegoCdnPlaybackAuthConfigured() {
  return playbackKey() !== null;
}

/** Master-only health state; never exposes key material or signed URLs. */
export function zegoCdnPlaybackAuthHealth() {
  return playbackKeyState().state;
}
