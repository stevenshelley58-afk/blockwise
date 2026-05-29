import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
