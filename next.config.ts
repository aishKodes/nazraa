import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Authenticated catalogue forms may include one bounded 12 MB PAG plus
  // artwork/sound. Individual asset validators retain their stricter limits.
  experimental: { serverActions: { bodySizeLimit: "16mb" } },
  turbopack: { root: process.cwd() },
};

export default nextConfig;
