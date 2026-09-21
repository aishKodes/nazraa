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
const releaseVersion = "2.4.61";
const releaseBuild = 7373;
const releaseApkUrl =
  "https://github.com/aishKodes/nazraa/releases/download/v2.4.61/Nazraa-Live-2.4.61-7373-release.apk";

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
  apkSizeBytes: 301_539_993,
  sha256: "84f0b18b9f971088f1f5d11ad096618d2e2dd20c23801e60badb0b206ae018b3",
  releaseDate: "2026-09-21",
  releaseNotes: [
    "Keeps shared game results durable through fast round transitions, with exact server-result landing animations.",
    "Shows real per-game Daily Top 20 winnings and current result histories without duplicate or stale rounds.",
    "Improves Lucky Seven, Greedy King, and Greedy Lion pacing, image results, real-player presence, and game-safe performance.",
  ],
  minimumAndroidVersion: "Android 7.0 or later",
};

export function releaseFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
