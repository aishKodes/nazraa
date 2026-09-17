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
const releaseVersion = "2.4.52";
const releaseBuild = 7364;
const releaseApkUrl =
  "https://github.com/aishKodes/nazraa/releases/download/v2.4.52/Nazraa-Live-2.4.52-7364.apk";

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
  apkSizeBytes: 300_505_577,
  sha256: "525fc9ff30283b1b0cfd04f6d9af97f908381043f64875673b64b29fd1a68e9c",
  releaseDate: "2026-09-17",
  releaseNotes: [
    "Makes Face audio-guest publishing server-authoritative and confirms the microphone before announcing the join.",
    "Keeps Face and Party boards open through recoverable membership and presence transitions.",
    "Improves LiveKit portrait capture and keeps active broadcasters awake while they publish.",
  ],
  minimumAndroidVersion: "Android 7.0 or later",
};

export function releaseFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
