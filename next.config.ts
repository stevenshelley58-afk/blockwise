import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  // Type errors fail the build. Do not re-enable ignoreBuildErrors — a green
  // typecheck is a release gate (also enforced in CI via `npm run check`).
  async redirects() {
    return [
      // The AI automation surface was renamed from "agents" to "ai-workforce"
      // to disambiguate from real-estate agents (research domain entities).
      { source: "/agents", destination: "/ai-workforce", permanent: true },
    ];
  },
};

export default nextConfig;
