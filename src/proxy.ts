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
  if (process.env.BLOCKWISE_HOMEPAGE_PREVIEW === "true") {
    if (pathname === "/concept" || pathname === "/motion-study" || pathname.startsWith("/_next/")) {
      return NextResponse.next();
    }
    return new NextResponse("Not found", { status: 404 });
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
