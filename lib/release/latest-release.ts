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
const releaseVersion = "2.4.65";
const releaseBuild = 7377;
const releaseApkUrl =
  "https://github.com/aishKodes/nazraa/releases/download/v2.4.65/Nazraa-Live-2.4.65-7377-release.apk";

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
  sha256: "19c06fe06fe5be02346e94c9bbdf1f3f9c421d11170dd2d3a92fd8dce11cd2c6",
  releaseDate: "2026-09-26",
  releaseNotes: [
    "Adds Master-only global device bans across all Nazraa accounts using the same recorded device identifier.",
    "Revokes matching sessions and prevents sign-in or new-account creation from a banned identifier.",
    "Prefers the Android app-scoped device ID over older install-only identifiers while preserving LiveKit and existing room features.",
  ],
  minimumAndroidVersion: "Android 7.0 or later",
};

export function releaseFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
