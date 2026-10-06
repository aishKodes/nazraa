/** Public asset/API origin for links returned to Nazraa clients. */
export function publicApiOrigin(): string {
  const raw = process.env.NAZRAA_PUBLIC_API_ORIGIN?.trim() || "https://api.nazraa.pixtra.site";
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !/^[a-z0-9.-]+$/i.test(url.hostname) ||
    (url.port && url.port !== "443")
  ) {
    throw new Error("NAZRAA_PUBLIC_API_ORIGIN must be an HTTPS origin.");
  }
  return url.origin;
}

/**
 * Optional CDN/asset origin.  It is deliberately separate from the API host:
 * operators may move immutable visual/audio objects behind a CDN without an
 * APK or a catalogue rewrite.  Until configured, assets remain on the
 * existing public API origin.
 */
export function publicAssetOrigin(): string {
  const raw = process.env.NAZRAA_ASSET_CDN_ORIGIN?.trim();
  if (!raw) return publicApiOrigin();
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !/^[a-z0-9.-]+$/i.test(url.hostname) ||
    (url.port && url.port !== "443")
  ) {
    throw new Error("NAZRAA_ASSET_CDN_ORIGIN must be an HTTPS origin.");
  }
  return url.origin;
}

/**
 * Existing catalog rows retain the URL minted before the VPS cutover. Keep
 * those durable records untouched and redirect only our own asset endpoints
 * in API responses; legal/policy links still belong to the public website.
 */
export function currentPublicAssetUrl(value: string | null): string | null {
  if (!value) return value;
  const legacy = "https://nazraa.vercel.app";
  if (!value.startsWith(`${legacy}/api/v1/assets/`) &&
      !value.startsWith(`${legacy}/api/v1/mobile/avatar/`)) return value;
  return `${publicAssetOrigin()}${value.slice(legacy.length)}`;
}
