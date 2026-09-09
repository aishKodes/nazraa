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
  version: "2.4.45",
  build: 7357,
  apkUrl:
    configuredApkUrl && /^https:\/\//.test(configuredApkUrl)
      ? configuredApkUrl
      : null,
  apkSizeBytes: 226_576_178,
  sha256: "5e5d444d771d424014fd83178f7940c46a55854c62dac2af243ddaf0928ab2af",
  releaseDate: "2026-09-08",
  releaseNotes: [
    "CDN-first Face and Party playback with protected RTC ceilings.",
    "Smoother room activity, gifts, games, and reconnect handling.",
    "Improved room-chat reliability and room safety controls.",
  ],
  minimumAndroidVersion: "Android 7.0 or later",
};

export function releaseFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
