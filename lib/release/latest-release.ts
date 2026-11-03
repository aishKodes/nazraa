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
const releaseVersion = "2.5.14";
const releaseBuild = 7426;
const releaseApkUrl =
  "https://github.com/aishKodes/Nazraa-Releases/releases/download/v2.5.13/Nazraa-Live-2.5.13-7426-release.apk";

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
  apkSizeBytes: 261459155,
  sha256: "6b36315d3154f89c894c072acd8182a96dbc138932bb6a429184bc6d28e0b001",
  releaseDate: "2026-11-03",
  releaseNotes: [
    "Princess: temporary Top 3 podium, larger photos and chair-specific winning effect.",
    "Pro: accepted bets, retry acknowledgements and settlement stay in sync.",
    "Permanent Gift Records, IST monthly totals and restored Host room titles.",
    "Selectable V6 role frames and complete Lucky Gift send, result and repeat flow.",
    "Updated gift artwork and quieter room notices; LiveKit and reward rules preserved.",
  ],
  minimumAndroidVersion: "Android 7.0 or later",
};

export function releaseFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
