import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { classifyDevice, externalReferrerHost, isTrackablePath, normalizeTrackedPath } from "@/lib/analytics/events";
import { dailyVisitorHash } from "@/lib/analytics/visitor";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/**
 * First-party page-view collector. Called by `PageViewTracker` via
 * `navigator.sendBeacon` on every client navigation. Stores no PII and no
 * raw IPs (see supabase/migrations/202606050003_page_analytics.sql).
 *
 * Always responds 204: analytics must never surface errors to visitors.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { path?: unknown; referrer?: unknown } | null;
    const path = normalizeTrackedPath(body?.path);
    if (!path || !isTrackablePath(path)) return new NextResponse(null, { status: 204 });

    const userAgent = request.headers.get("user-agent") ?? "";
    const device = classifyDevice(userAgent);
    if (device === "bot") return new NextResponse(null, { status: 204 });

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    if (!serviceKey) return new NextResponse(null, { status: 204 });

    const forwardedFor = request.headers.get("x-forwarded-for") ?? "";
    const ip = forwardedFor.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
    const salt = createHash("sha256").update(`blockwise-page-analytics:${serviceKey}`).digest("hex");
    const ownHost = request.headers.get("host")?.split(":")[0]?.replace(/^www\./, "").toLowerCase() ?? null;

    const supabase = createSupabaseServiceClient();
    await supabase.from("page_views").insert({
      path,
      referrer: externalReferrerHost(body?.referrer, ownHost),
      visitor_hash: dailyVisitorHash(ip, userAgent, salt, new Date()),
      device,
      country: request.headers.get("x-vercel-ip-country"),
    });
  } catch {
    // Best-effort: never let analytics break a page load.
  }
  return new NextResponse(null, { status: 204 });
}
