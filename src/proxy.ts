import { NextResponse, type NextRequest } from "next/server";

import { niche } from "@/config/niche";
import { isFeatureRouteAvailable } from "@/lib/features/route-availability";
import { refreshSupabaseSession } from "@/lib/supabase/proxy";

const AUTHENTICATED_API_PREFIXES = ["/api/adstudio/", "/api/operator/"] as const;
// Plates and patches preserve source-ad pixels. Safe gallery samples remain
// public by design, but the source-derived render parts require a workspace
// session and must never be exposed through Next's image optimizer cache.
const TEMPLATE_ASSET_PREFIX = "/adstudio-templates/";

function isSourceDerivedTemplateAsset(pathname: string): boolean {
  if (!pathname.startsWith(TEMPLATE_ASSET_PREFIX)) return false;
  const filename = pathname.slice(pathname.lastIndexOf("/") + 1);
  return filename.startsWith("plate-") || filename.startsWith("patch-");
}

function optimizedAssetPath(request: NextRequest): string | null {
  if (request.nextUrl.pathname !== "/_next/image") return null;
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) return null;
  try {
    const target = new URL(raw, request.nextUrl);
    return target.pathname;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const optimizedPath = optimizedAssetPath(request);

  // No product surface optimizes v2 render parts. Reject this path for every
  // caller so an authenticated request can never seed a shared optimizer cache.
  if (optimizedPath && isSourceDerivedTemplateAsset(optimizedPath)) {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "Cache-Control": "private, no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (pathname === "/_next/image") return NextResponse.next();

  // Dev tooling (render harness, render smoke) may run on localhost and on
  // flag-gated Preview deploys; it must never exist on production.
  if (process.env.VERCEL_ENV === "production" && pathname.startsWith("/api/dev/")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!isFeatureRouteAvailable(pathname, niche.features)) {
    return pathname.startsWith("/api/")
      ? NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } })
      : new NextResponse("Not found", {
          status: 404,
          headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
        });
  }

  const session = await refreshSupabaseSession(request);
  if (
    AUTHENTICATED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix)) &&
    !session.authenticated
  ) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (
    isSourceDerivedTemplateAsset(pathname)
    && !session.authenticated
  ) {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "Cache-Control": "private, no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (isSourceDerivedTemplateAsset(pathname)) {
    session.response.headers.set("Cache-Control", "private, no-store");
  }

  return session.response;
}

export const config = {
  matcher: [
    "/_next/image",
    "/adstudio-templates/:path*",
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};
