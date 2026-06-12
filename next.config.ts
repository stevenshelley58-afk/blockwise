import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  outputFileTracingIncludes: {
    "/operator/research": ["./hermes/skills/**/*"],
    "/api/operator/research/skills": ["./hermes/skills/**/*"],
    "/api/operator/research/skills/[slug]": ["./hermes/skills/**/*"],
  },
  // Tree-shake heavy barrel-export libs so only used modules ship to the client.
  // lucide-react is already optimized by Next's defaults; recharts is not.
  experimental: { optimizePackageImports: ["recharts"] },
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
