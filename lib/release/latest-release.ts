export type PublicRelease = {
  version: string;
  build: number;
  apkUrl: string | null;
  apkSizeBytes: number;
  sha256: string;
  releaseDate: string;
  releaseNotes: readonly string[];
  minimumAndroidVersion: string;
};

const configuredApkUrl = process.env.NAZRAA_LATEST_APK_URL?.trim();
// This release points only to the uploaded, verified public APK. Keeping the
// version, asset path and checksum together prevents an update endpoint from
// ever advertising a binary that is not available for download.
const releaseVersion = "2.4.56";
const releaseBuild = 7368;
const releaseApkUrl =
  "https://github.com/aishKodes/nazraa/releases/download/v2.4.56/Nazraa-Live-2.4.56-7368.apk";

// A stale environment URL must never make the public download page point to
// the previous binary after a production release. Operations can still host
// the matching build elsewhere, but its versioned GitHub path must agree with
// this release before it overrides the verified default asset.
const matchingConfiguredApkUrl =
  configuredApkUrl && configuredApkUrl.includes(`/v${releaseVersion}/`)
    ? configuredApkUrl
    : null;

// This is the single source of truth for the public site and the future
// in-app update check. Hosting can move from GitHub Releases to a branded CDN
// by changing only NAZRAA_LATEST_APK_URL, not any component or mobile build.
export const latestPublicRelease: PublicRelease = {
  version: releaseVersion,
  build: releaseBuild,
  apkUrl: matchingConfiguredApkUrl ?? releaseApkUrl,
  apkSizeBytes: 145_548_789,
  sha256: "a65e0dc518086c9d3f9dedde3dd880eac832baf6e45cdbd5c456d393e6f60fdc",
  releaseDate: "2026-09-18",
  releaseNotes: [
    "Adds the stronger on-device Glow beauty preset for LiveKit Hosts, with safe low-end fallback.",
    "Completes the PK result layer with bounded win, loss, and draw visuals while keeping both Host videos stable.",
    "Hardens every shared game across 20 authoritative settlement and 15-second round-boundary cycles.",
  ],
  minimumAndroidVersion: "Android 7.0 or later",
};

export function releaseFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
