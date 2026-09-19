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
const releaseVersion = "2.4.58";
const releaseBuild = 7370;
const releaseApkUrl =
  "https://github.com/aishKodes/nazraa/releases/download/v2.4.58/Nazraa-Live-2.4.58-7370.apk";

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
  apkSizeBytes: 301_523_609,
  sha256: "4f1f3e1beadf2c416fff5b181ffe75cd0516f1d4ff958ce3ee1229930686d3c9",
  releaseDate: "2026-09-19",
  releaseNotes: [
    "Keeps the LiveKit Face video surface stable while PK score and supporter updates arrive.",
    "Adds the reference-aligned PK battle layout, authoritative Red/Blue score bar, timer, and top-gifter strips.",
    "Includes the stronger on-device Glow beauty preset with a safe low-end fallback.",
  ],
  minimumAndroidVersion: "Android 7.0 or later",
};

export function releaseFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
