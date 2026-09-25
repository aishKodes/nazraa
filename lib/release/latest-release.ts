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
const releaseVersion = "2.4.62";
const releaseBuild = 7374;
const releaseApkUrl =
  "https://github.com/aishKodes/nazraa/releases/download/v2.4.62/Nazraa-Live-2.4.62-7374-release.apk";

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
  apkSizeBytes: 300_883_029,
  sha256: "d119c1c478d090bed298e626aa330229690e5e3839dddb7ab78c6340fa1d9bd0",
  releaseDate: "2026-09-25",
  releaseNotes: [
    "Improves Face camera capture to select the full sensor mode for clearer portrait Live video.",
    "Corrects LiveKit bitrate diagnostics so video-quality issues can be measured accurately.",
    "Preserves the existing Face, Party, PK, rewards, games, and economy architecture.",
  ],
  minimumAndroidVersion: "Android 7.0 or later",
};

export function releaseFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
