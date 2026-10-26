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
const releaseVersion = "2.5.07";
const releaseBuild = 7419;
const releaseApkUrl =
  "https://github.com/aishKodes/Nazraa-Releases/releases/download/v2.5.07/Nazraa-Live-2.5.07-7419-release.apk";

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
  apkSizeBytes: 259_196_678,
  sha256: "d6ccaed54c20d04e30aab9cd7231aff511d7414f288c1ac9e72e6e23541d5cfb",
  releaseDate: "2026-10-26",
  releaseNotes: [
    "Face and Party boards recover from temporary media interruptions without losing the Live session.",
    "Eligible Hosts earn two claimable 1,750-Diamond rewards after each completed 30-minute block, up to 3,500 per day.",
    "Improved startup retries and preserved microphone, camera and reward progress during recovery.",
  ],
  minimumAndroidVersion: "Android 7.0 or later",
};

export function releaseFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
