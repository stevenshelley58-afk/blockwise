import type { NextConfig } from "next";

function safeOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function sentryIngestOrigin(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    return new URL(dsn).origin;
  } catch {
    return null;
  }
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  // The OSS product image runs Next's standalone server behind Caddy.
  output: "standalone",
  // @napi-rs/canvas ships a native .node binding that Turbopack cannot place in
  // ESM chunks; it is only used server-side (ad-deterministic-renderer), so
  // externalize it and let the server require() the binding at runtime.
  serverExternalPackages: ["@napi-rs/canvas"],
  // Tree-shake heavy barrel-export libs so only used modules ship to the client.
  // lucide-react is already optimized by Next's defaults; recharts is not.
  // Sharp resolves its native implementation at runtime. Vercel's trace can
  // otherwise omit the Linux libvips shared object from these Node functions.
  outputFileTracingIncludes: {
    "/api/adstudio/ads/*/media": [
      "./node_modules/sharp/**/*",
      "./node_modules/@img/sharp-linux-x64/**/*",
      "./node_modules/@img/sharp-libvips-linux-x64/**/*",
    ],
    "/api/adstudio/customer-media": [
      "./node_modules/sharp/**/*",
      "./node_modules/@img/sharp-linux-x64/**/*",
      "./node_modules/@img/sharp-libvips-linux-x64/**/*",
    ],
  },
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
    // Security headers for the standalone Next server behind Caddy.
    // connect-src is composed from the runtime origins the app actually
    // talks to from the browser: its own origin, the Supabase REST/auth
    // host, the Sentry ingest host, and Vercel analytics in preview.
    const supabaseOrigin = safeOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const sentryOrigin = sentryIngestOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN);
    const connectSrc = ["'self'", supabaseOrigin, sentryOrigin, "https://va.vercel-scripts.com"]
      .filter((value): value is string => Boolean(value))
      .join(" ");
    return [
      {
        source: "/:path*",
        headers: [
          {
            // 'unsafe-inline' for script-src is required by Next.js's inline
            // bootstrap; removing it requires nonce-based middleware, tracked
            // as follow-up hardening. style-src needs it for the Tailwind/
            // shadcn runtime styles. Konva/canvas rendering uses blob: URLs.
            key: "Content-Security-Policy",
            value: `default-src 'self'; script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src ${connectSrc}; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`,
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
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
