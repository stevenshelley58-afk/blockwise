import { NextResponse, type NextRequest } from "next/server";

import { niche } from "@/config/niche";
import { providerCallbackRecovery } from "@/lib/auth/provider-callback-recovery";
import { isFeatureRouteAvailable } from "@/lib/features/route-availability";
import { refreshSupabaseSession } from "@/lib/supabase/proxy";

const AUTHENTICATED_API_PREFIXES = ["/api/adstudio/", "/api/operator/"] as const;

/** Routes that must never answer with a provider callback in their query. */
const CALLBACK_RECOVERY_PATHS = ["/", "/login", "/signup", "/home"] as const;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Preview is a read-only UI: do not refresh auth or expose product endpoints.
  const homepagePreview = process.env.BLOCKWISE_HOMEPAGE_PREVIEW === "true";
  const metaConnectPreview = process.env.BLOCKWISE_META_CONNECT_PREVIEW === "true";
  if (homepagePreview || metaConnectPreview) {
    const allowedPage = homepagePreview
      ? pathname === "/concept"
      : pathname === "/concept/meta-connect";
    const previewHeaders = new Headers({
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    });
    const revision = process.env.BLOCKWISE_BUILD_REVISION;
    if (/^[a-f0-9]{40}$/i.test(revision ?? "")) {
      previewHeaders.set("X-Preview-Revision", revision!);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new NextResponse("Method not allowed", { status: 405, headers: previewHeaders });
    }
    if (metaConnectPreview && pathname === "/" && request.method === "GET") {
      const url = request.nextUrl.clone();
      url.pathname = "/concept/meta-connect";
      return NextResponse.redirect(url, { headers: previewHeaders });
    }
    if (!allowedPage && !pathname.startsWith("/_next/")) {
      return new NextResponse("Not found", { status: 404, headers: previewHeaders });
    }

    // The edge route strips these too. Repeat it here so a direct internal
    // request cannot make auth material available to preview rendering.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("authorization");
    requestHeaders.delete("cookie");
    return NextResponse.next({ request: { headers: requestHeaders }, headers: previewHeaders });
  }

  if (process.env.NODE_ENV === "production" && pathname.startsWith("/api/dev/")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Google returns to GoTrue, and GoTrue's success path has been observed
  // sending the browser to the site root with the auth code in the query
  // string. The code is only good once and only /auth/confirm can exchange it,
  // so recover it here, before any page renders and before any session work.
  if (CALLBACK_RECOVERY_PATHS.includes(pathname as (typeof CALLBACK_RECOVERY_PATHS)[number])) {
    const recovery = providerCallbackRecovery(request.nextUrl.search.replace(/^\?/, ""));
    if (recovery) {
      const [path, query] = recovery.split("?");
      const url = request.nextUrl.clone();
      url.pathname = path;
      url.search = query ? `?${query}` : "";
      return NextResponse.redirect(url);
    }
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

  return session.response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)"],
};
