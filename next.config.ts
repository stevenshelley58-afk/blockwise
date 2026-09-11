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

const homepagePreview = process.env.BLOCKWISE_HOMEPAGE_PREVIEW === "true";
const previewBasePath = homepagePreview ? "/homepage-preview" : "";

const nextConfig: NextConfig = {
  basePath: previewBasePath,
  // Embedded at build time: a mutable runtime env must not impersonate a release.
  env: {
    BLOCKWISE_HOMEPAGE_PREVIEW: homepagePreview ? "true" : "false",
    NEXT_PUBLIC_BASE_PATH: previewBasePath,
    BLOCKWISE_BUILD_REVISION: /^[a-f0-9]{40}$/i.test(process.env.BLOCKWISE_BUILD_REVISION ?? "")
      ? process.env.BLOCKWISE_BUILD_REVISION
      : "",
  },
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  // The OSS product image runs Next's standalone server behind Caddy.
  output: "standalone",
  // @napi-rs/canvas ships a native .node binding that Turbopack cannot place in
  // ESM chunks; it is only used server-side (ad-deterministic-renderer), so
  // externalize it and let the server require() the binding at runtime.
  serverExternalPackages: ["@napi-rs/canvas"],
  images: {
    // sharp is a direct dependency and is what the standalone server uses.
    // AVIF first: measured ~20% under WebP for the same visual result, and the
    // optimizer falls back automatically for browsers without support.
    formats: ["image/avif", "image/webp"],
    // The default ladder tops out at 3840 and starts at 640, so a 345px card
    // was being offered a 640px+ file. These are the widths the customer
    // surfaces actually render at (ad cards, gallery cards, hero deck).
    deviceSizes: [345, 420, 640, 828, 1080],
    imageSizes: [96, 160, 220, 320],
    // The optimizer caches one resize per (url, width, format).
    minimumCacheTTL: 2_592_000,
  },
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
    // Barrel-export packages that ship far more than the routes import.
    // recharts and radix-ui are the two heaviest barrels in this app;
    // lucide-react and motion are covered by Next's built-in default list.
    optimizePackageImports: ["recharts", "radix-ui"],
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

  // Public suburb reports are linked from outbound email as blockwise.sale/6153.
  // A plain array is afterFiles: real pages win, and only bare four-digit paths
  // fall through to the report route. The proxy sees the original "/6153" path,
  // which matches no feature-gated prefix, so the gate still governs "/suburb".
  async rewrites() {
    return [
      { source: "/:postcode(\\d{4})", destination: "/suburb/:postcode" },
    ];
  },
  async headers() {
    // Security headers for the standalone Next server behind Caddy.
    // Directives are composed from the verified browser-loaded provider
    // inventory (do not add origins without a code reference):
    // - script: self, Next inline bootstrap, Google Identity Services
//   (components/auth/sso-buttons.tsx), Cloudflare Turnstile
    //   (components/auth/turnstile-verification.tsx), Google Tag Manager
    //   gtag.js (components/marketing-analytics.tsx), Vercel analytics.
    // - frame: Google Identity Services button iframe (Google owns and renders
//   it), Cloudflare Turnstile widget iframe.
    // - image/media: self, data:, blob: (Konva canvas), Meta ad creatives
    //   rendered by Ad Radar/creative viewer (*.fbcdn.net,
    //   *.cdninstagram.com), Facebook page images.
    // - connect: self, Supabase REST/auth, Sentry ingest, Vercel analytics,
    //   Google Analytics/gtag collect endpoints, including regional collection:
    //   https://developers.google.com/tag-platform/security/guides/csp
    const supabaseOrigin = safeOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const researchStorageOrigin = safeOrigin(process.env.NEXT_PUBLIC_RESEARCH_STORAGE_URL);
    const sentryOrigin = sentryIngestOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN);
    const connectSrc = [
      "'self'",
      supabaseOrigin,
      sentryOrigin,
      "https://va.vercel-scripts.com https://static.cloudflareinsights.com",
      "https://*.google-analytics.com",
      "https://*.analytics.google.com",
      "https://analytics.google.com",
      "https://www.googletagmanager.com",
      "https://accounts.google.com",
      "https://cloudflareinsights.com",
      "https://www.clarity.ms",
      "https://c.clarity.ms",
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ");
    const imgSrc = [
      "'self'",
      "https://*.google-analytics.com",
      "https://www.googletagmanager.com",
      "data:",
      "blob:",
      researchStorageOrigin,
      "https://*.fbcdn.net",
      "https://*.cdninstagram.com",
      "https://www.facebook.com",
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ");
    const mediaSrc = [
      "'self'",
      "blob:",
      researchStorageOrigin,
      "https://*.fbcdn.net",
      "https://*.cdninstagram.com",
    ]
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
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://accounts.google.com https://challenges.cloudflare.com https://www.googletagmanager.com https://www.clarity.ms https://va.vercel-scripts.com https://static.cloudflareinsights.com",
              "style-src 'self' 'unsafe-inline' https://accounts.google.com",
              "img-src " + imgSrc,
              "media-src " + mediaSrc,
              "font-src 'self' data:",
              `connect-src ${connectSrc}`,
              "frame-src 'self' https://accounts.google.com https://content-accounts.google.com https://challenges.cloudflare.com",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
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
      // Files under public/ are served with `max-age=0` by default, so every
      // visit revalidated ~2.9 MB of hero imagery and the Ad Studio webfonts
      // even though they change only at release. These filenames are not
      // content-hashed, so a day of freshness plus a week of background
      // revalidation keeps repeat views free without ever pinning a stale
      // asset for long. (adstudio-thumbnails above IS content-hashed.)
      {
        source: "/:dir(hero|home|ads|brand|icons|fonts|adstudio-samples|adstudio-fixtures)/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
