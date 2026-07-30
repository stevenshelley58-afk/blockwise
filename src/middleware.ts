import { NextResponse, type NextRequest } from "next/server";
import { niche } from "@/config/niche";
import { isFeatureRouteAvailable } from "@/lib/features/route-availability";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isFeatureRouteAvailable(pathname, niche.features)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const isProtected =
    pathname.startsWith("/api/adstudio/") || pathname.startsWith("/api/operator/");

  if (!isProtected) return NextResponse.next();

  // Check for Supabase auth cookie (sb-*-auth-token)
  const hasCookie = [...request.cookies.getAll()].some(
    (c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"),
  );

  if (!hasCookie) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/adstudio/:path*", "/api/operator/:path*", "/ad-radar/:path*", "/property-check/:path*", "/suburb/:path*", "/audit", "/hero-lab", "/operator/research/:path*"],
};
