import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  typescript: { ignoreBuildErrors: true },
  async redirects() {
    return [
      { source: "/monitor", destination: "/results", permanent: false },
      { source: "/research", destination: "/ad-radar", permanent: false },
      { source: "/research/:path*", destination: "/ad-radar/:path*", permanent: false },
      { source: "/campaigns", destination: "/results", permanent: false },
    ];
  },
};

export default nextConfig;
