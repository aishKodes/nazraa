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
const releaseVersion = "2.4.84";
const releaseBuild = 7396;
const releaseApkUrl =
  "https://github.com/aishKodes/Nazraa-Releases/releases/download/v2.4.84/Nazraa-Live-2.4.84-7396-release.apk";

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
  apkSizeBytes: 225_197_862,
  sha256: "6914ae1f1523c1aa96a0219543b9c83f9337f183fc7833eccc78ed7c6f61ca34",
  releaseDate: "2026-10-15",
  releaseNotes: [
    "Adds a separate TeenPatti game: Green, Blue and Red Chairs, one standard deck, exact 3× return less a 3% service fee.",
    "Original Nazraa artwork, animated card reveals and chips, server-owned results, rapid betting, history and Daily Top 20.",
    "Existing Teen Patti Pro, Party microphone/adaptive chat, Face Live, LiveKit, rewards and Host payout functionality preserved.",
  ],
  minimumAndroidVersion: "Android 7.0 or later",
};

export function releaseFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
