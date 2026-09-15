import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://blockwise.sale";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Keep the authenticated app and API surface out of search indexes.
        disallow: [
          "/api/",
          "/login",
          "/home",
          "/settings",
          "/pwa",
          "/reset-password",
          "/forgot-password",
          "/ad-builder",
          "/property-check",
          "/leads",
          "/performance",
          "/connect-meta",
          "/help",
          "/ad-radar",
          "/suburb",
          "/audit",
          "/ad-studio",
          "/operator",
          "/workforce",
          "/model-control",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
