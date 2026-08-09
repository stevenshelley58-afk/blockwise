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
  experimental: {
    optimizePackageImports: ["recharts"],
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "blockwise-tan.vercel.app" }],
        destination: "https://blockwise.sale/:path*",
        permanent: true,
      },
      { source: "/monitor", destination: "/results", permanent: false },
      { source: "/blog", destination: "/guides", permanent: true },
      { source: "/blog/:path*", destination: "/guides/:path*", permanent: true },
      { source: "/research", destination: "/self-serve", permanent: false },
      { source: "/research/:path*", destination: "/self-serve", permanent: false },
      { source: "/campaigns", destination: "/results", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/adstudio-thumbnails/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
