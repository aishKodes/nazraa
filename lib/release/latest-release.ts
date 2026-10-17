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
const releaseVersion = "2.4.93";
const releaseBuild = 7405;
const releaseApkUrl =
  "https://github.com/aishKodes/Nazraa-Releases/releases/download/v2.4.93/Nazraa-Live-2.4.93-7405-release.apk";

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
  apkSizeBytes: 239_830_662,
  sha256: "37bf0bc21fce2588a3beb8bae93adf1d8241aa7ff294ac39144a797fce127401",
  releaseDate: "2026-10-17",
  releaseNotes: [
    "Live reliability: recover SDK cleanup without leaving the room; fix a camera-switch beauty-buffer crash.",
    "Live time: retain checkpoint fractions and reconcile signed publishing evidence with the existing claimable-reward ledger.",
    "Stronger device-local beauty, protected facial detail and low-tier fallback; remotely managed PAG effect support.",
    "Teen Patti Princess supports visible first-card rounds with transparent, committed per-chair quotes when enabled by Master.",
    "About identifies the exact source commit. Existing LiveKit infrastructure, Party seats, other games and historical payout records are preserved.",
  ],
  minimumAndroidVersion: "Android 7.0 or later",
};

export function releaseFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
