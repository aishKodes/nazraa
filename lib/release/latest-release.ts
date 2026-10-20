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
const releaseVersion = "2.5.02";
const releaseBuild = 7414;
const releaseApkUrl =
  "https://github.com/aishKodes/Nazraa-Releases/releases/download/v2.5.02/Nazraa-Live-2.5.02-7414-release.apk";

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
  apkSizeBytes: 259_262_338,
  sha256: "28d3fdebf4d616f318d236e6693885cc3bae1c55bd8357eb30e71187fccad07a",
  releaseDate: "2026-10-21",
  releaseNotes: [
    "Party now has one Main Settings control with Theme Setting inside, plus a distinct Tools icon.",
    "Larger Audio PK seats reuse Party controls; the close button ends only PK and preserves the Party. Your local team appears left/red.",
    "The Party Diamond counter shows committed gifts across the current session, including seated participants, without changing personal balances.",
    "New Teen Patti Princess rounds pay exactly 3.00× gross less the existing 3% fee. Accepted historical quotes and Teen Patti Pro remain unchanged.",
    "Preserves LiveKit startup/recovery, the smooth authoritative clock, three-line Face feed, beauty and current reward/Claim rules. Five successful Host restores within 180 seconds exclude offline time.",
  ],
  minimumAndroidVersion: "Android 7.0 or later",
};

export function releaseFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
