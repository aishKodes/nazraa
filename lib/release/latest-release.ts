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
const releaseVersion = "2.4.54";
const releaseBuild = 7366;
const releaseApkUrl =
  "https://github.com/aishKodes/nazraa/releases/download/v2.4.54/Nazraa-Live-2.4.54-7366.apk";

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
  sha256: "c63ff83a16e19d8945d8100a532ed5f695fff820158b5e1da5e12560ad6b420c",
  releaseDate: "2026-09-17",
  releaseNotes: [
    "Hardens the fail-open LiveKit camera beauty renderer and validates its exact external-texture shader on Android.",
    "Normal camera publishing continues unchanged if optional on-device beauty cannot run.",
    "Keeps LiveKit room access, rewards, games, chat, and gifting unchanged.",
  ],
  minimumAndroidVersion: "Android 7.0 or later",
};

export function releaseFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
