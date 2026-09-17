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
const releaseVersion = "2.4.55";
const releaseBuild = 7367;
const releaseApkUrl =
  "https://github.com/aishKodes/nazraa/releases/download/v2.4.55/Nazraa-Live-2.4.55-7367.apk";

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
  apkSizeBytes: 301_595_227,
  sha256: "b5bbed0852a24d93e4e570ddfe063dfbcdd3625cace02a3f285881358a3958c0",
  releaseDate: "2026-09-17",
  releaseNotes: [
    "Adds an indexed Daily Top Winners board using real, settled, net-positive game results from the current server day.",
    "Makes every enabled game retain its latest 10 settled results without blocking active play.",
    "Refines Teen Patti, Luck77, Greedy King, Bounty Football, and Game Center presentation while preserving LiveKit, rewards, chat, and gifting.",
  ],
  minimumAndroidVersion: "Android 7.0 or later",
};

export function releaseFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
