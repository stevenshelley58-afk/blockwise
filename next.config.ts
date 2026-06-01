import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  typescript: { ignoreBuildErrors: true },
  async redirects() {
    return [
      // The AI automation surface was renamed from "agents" to "ai-workforce"
      // to disambiguate from real-estate agents (research domain entities).
      { source: "/agents", destination: "/ai-workforce", permanent: true },
    ];
  },
};

export default nextConfig;
