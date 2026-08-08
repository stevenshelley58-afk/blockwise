import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  // Native pixel backend of the AdStudio v2 renderer. Must be required at
  // runtime from node_modules, never bundled — its prebuilt .node binary and
  // platform package resolution break inside webpack output.
  serverExternalPackages: ["@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/operator/research": ["./hermes/skills/**/*"],
    "/api/operator/research/skills": ["./hermes/skills/**/*"],
    "/api/operator/research/skills/[slug]": ["./hermes/skills/**/*"],
    // The renderer requires @napi-rs/canvas at runtime from node_modules;
    // serverExternalPackages keeps it out of the bundle, and this copies the
    // package + linux prebuilt binary into the deploy (smoke, /doc,
    // campaigns all render).
    "/api/*": [
      "./node_modules/@napi-rs/canvas/**/*",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**/*",
      "./src/lib/adstudio/template-gallery-v2/**/*",
    ],
    "/ad-studio": [
      "./src/lib/adstudio/template-gallery-v2/**/*",
    ],
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
