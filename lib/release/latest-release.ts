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
const releaseVersion = "2.4.59";
const releaseBuild = 7371;
const releaseApkUrl =
  "https://github.com/aishKodes/nazraa/releases/download/v2.4.59/Nazraa-Live-2.4.59-7371.apk";

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
  sha256: "bd514f4c5502b5148fb2a97699ceb64afb7631b940fea2ff43ae59fe66cb6a1f",
  releaseDate: "2026-09-19",
  releaseNotes: [
    "Publishes Face Live at a full 720×1280 high layer, up to 30 FPS and 2.7 Mbps on capable Android devices.",
    "Prevents Face viewers from being held on a low simulcast layer while the video canvas is first laid out or restored.",
    "Strengthens full-resolution on-device Beauty while keeping low-end pass-through and video-quality safeguards.",
  ],
  minimumAndroidVersion: "Android 7.0 or later",
};

export function releaseFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
