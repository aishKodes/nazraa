import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  turbopack: { root: process.cwd() },
};

export default nextConfig;
