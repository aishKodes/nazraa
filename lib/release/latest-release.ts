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

// This is the single source of truth for the public site and the future
// in-app update check. Hosting can move from GitHub Releases to a branded CDN
// by changing only NAZRAA_LATEST_APK_URL, not any component or mobile build.
export const latestPublicRelease: PublicRelease = {
  version: "2.4.51",
  build: 7363,
  apkUrl:
    configuredApkUrl && /^https:\/\//.test(configuredApkUrl)
      ? configuredApkUrl
      : null,
  apkSizeBytes: 300_505_577,
  sha256: "272d6bb8e81b8bd2534fd855f414e33883f5d51e24108115462e2eeb3b4207f7",
  releaseDate: "2026-09-16",
  releaseNotes: [
    "Moves new Face and Party rooms to Nazraa's self-hosted LiveKit media service.",
    "Keeps passive viewers subscribe-only and grants microphone publishing only after server approval.",
    "Adds authenticated provider media evidence to the existing Live-session reward ledger.",
  ],
  minimumAndroidVersion: "Android 7.0 or later",
};

export function releaseFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
