import type { NextConfig } from "next";

const nativeRendererFiles = [
  "./node_modules/@napi-rs/canvas/**/*",
  "./node_modules/@napi-rs/canvas-linux-x64-gnu/**/*",
  "./public/fonts/adstudio/**/*",
  "./src/lib/adstudio/template-gallery-v2/**/*",
  "./src/lib/adstudio/template-assets-v2/**/*",
];

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
    // Only routes that rasterize v2 ads receive the native binary, fonts and
    // private render parts. A broad /api/* include would add ~130 MB to every
    // function and obscure accidental whole-repository traces.
    "/api/adstudio/campaigns": nativeRendererFiles,
    "/api/adstudio/creatives/[id]/doc": nativeRendererFiles,
    "/api/dev/render-smoke": nativeRendererFiles,
    "/api/operator/template-studio/[id]": [
      ...nativeRendererFiles,
      "./meta_ad_candidates/**/*",
      "./public/adstudio-safe-assets/**/*",
      "./src/lib/adstudio/template-gallery/**/*",
    ],
    "/dev/render-harness/render": [
      ...nativeRendererFiles,
      "./tests/fixtures/adstudio-v2/**/*",
    ],
    "/api/adstudio/templates-v2/[id]": ["./src/lib/adstudio/template-gallery-v2/**/*"],
    "/api/operator/template-studio": ["./src/lib/adstudio/template-gallery-v2/**/*"],
    "/api/operator/template-studio/source": [
      "./src/lib/adstudio/template-gallery-v2/**/*",
      "./meta_ad_candidates/**/*",
    ],
    // The private-source endpoint is the only template-trace route that reads
    // the source corpus. Keep those files out of metadata and regeneration.
    "/api/operator/template-trace/[id]/source-image": ["./meta_ad_candidates/**/*"],
    "/operator/template-studio": ["./src/lib/adstudio/template-gallery-v2/**/*"],
    "/ad-studio": [
      "./src/lib/adstudio/template-gallery-v2/**/*",
    ],
  },
  outputFileTracingExcludes: {
    // Regeneration obtains its approved public reference through the deployed
    // static asset URL. It must never package the public tree or private source
    // corpus just because future code adds a dynamic filesystem read here.
    "/api/operator/template-trace/[id]/regenerate": [
      "./meta_ad_candidates/**/*",
      "./public/**/*",
    ],
    // Studio mutations are disabled in production before this code path can
    // write a sample. Turbopack otherwise follows that dev-only destination
    // and packages every unrelated public asset into the operator function.
    "/api/operator/template-studio/*": [
      "./public/ads/**/*",
      "./public/adstudio-samples/**/*",
      "./public/adstudio-templates/**/*",
      "./public/adstudio-thumbnails/**/*",
      "./public/brand/**/*",
      "./public/guides/**/*",
      "./public/hero/**/*",
      "./public/hero-lab/**/*",
      "./public/home/**/*",
      "./public/icons/**/*",
      "./public/offline.html",
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
