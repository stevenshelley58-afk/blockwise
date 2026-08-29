import { NextResponse, type NextRequest } from "next/server";

import { niche } from "@/config/niche";
import { isFeatureRouteAvailable } from "@/lib/features/route-availability";
import { refreshSupabaseSession } from "@/lib/supabase/proxy";

const AUTHENTICATED_API_PREFIXES = ["/api/adstudio/", "/api/operator/"] as const;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (process.env.NODE_ENV === "production" && pathname.startsWith("/api/dev/")) {
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

  return session.response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)"],
};
