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
const releaseVersion = "2.4.53";
const releaseBuild = 7365;
const releaseApkUrl =
  "https://github.com/aishKodes/nazraa/releases/download/v2.4.53/Nazraa-Live-2.4.53-7365.apk";

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
  apkSizeBytes: 300_489_149,
  sha256: "301831725d06df70384b61239715ac1e0e6a7b22d998c46e44695e66ecec31cd",
  releaseDate: "2026-09-17",
  releaseNotes: [
    "Adds a fail-open LiveKit camera-frame beauty path: normal camera publishing continues if it is unavailable.",
    "Keeps PK cross-room media restricted to the opposing Host and prevents peer-team membership metadata reaching spectators.",
    "Adds sampled anonymous join-stage telemetry and improves daily game winners, history, and visual game cards.",
  ],
  minimumAndroidVersion: "Android 7.0 or later",
};

export function releaseFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
