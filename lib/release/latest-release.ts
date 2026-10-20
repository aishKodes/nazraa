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
const releaseVersion = "2.5.00";
const releaseBuild = 7412;
const releaseApkUrl =
  "https://github.com/aishKodes/Nazraa-Releases/releases/download/v2.5.00/Nazraa-Live-2.5.00-7412-release.apk";

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
  apkSizeBytes: 259_180_422,
  sha256: "6e5b79eadecd2cdcb5f2ed264099f67b05300a6762e6c662a72a1def747faf74",
  releaseDate: "2026-10-20",
  releaseNotes: [
    "Release candidate: server-authoritative Host Auto Resume preserves unfinished publishing progress for up to 180 seconds, without counting offline time.",
    "Five successful qualifying restores per Host per business day, shared across Face and Party; retry-safe accounting preserves the existing reward policy and manual Claim flow.",
    "Beauty V5.1 tuning is preserved, with sustained-pressure tier fallback, a minimal fail-open path and gradual recovery.",
    "About identifies the exact source commit; bounded media diagnostics help investigate real-device video issues without exporting credentials or private messages.",
    "LiveKit infrastructure, Party seats, games, gifts, wallet and historical payout records are unchanged. Physical-device field certification remains pending.",
  ],
  minimumAndroidVersion: "Android 7.0 or later",
};

export function releaseFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
