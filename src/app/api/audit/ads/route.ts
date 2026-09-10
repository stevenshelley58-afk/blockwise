import { NextResponse, type NextRequest } from "next/server";

import { generateAuditAds } from "@/lib/audit/audit-ad-engine";
import { loadPostcodeGap } from "@/lib/audit/postcode-gap";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POSTCODE = /^\d{4}$/;

type GenerateBody = {
  postcode?: string;
  website?: string;
  name?: string;
  suburb?: string;
};

/**
 * POST /api/audit/ads
 *
 * Anonymous. Builds three finished ad creatives for an agency in a postcode:
 * our templates, their Brand Pack colours, one of their own listing photos
 * where we have one, and copy aimed at the angle their local market is
 * missing. Rendering is expensive, so the route is rate limited by connection.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as GenerateBody;
  const postcode = (body.postcode ?? "").trim();
  const website = (body.website ?? "").trim() || null;
  const name = (body.name ?? "").trim() || null;

  if (!POSTCODE.test(postcode)) {
    return NextResponse.json({ error: "Enter a valid 4-digit postcode." }, { status: 400 });
  }
  if (!website && !name) {
    return NextResponse.json({ error: "Add your agency website or your agency name." }, { status: 400 });
  }

  const limit = await checkRateLimit(null, connectionKey(request), {
    windowSeconds: 600,
    maxRequests: 8,
    bucket: "audit-ad-generate",
    failClosed: false,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many audits from this connection. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const gap = await loadPostcodeGap(postcode);
  if (!gap) {
    return NextResponse.json({ error: "We do not have a report for that postcode yet." }, { status: 404 });
  }

  try {
    const service = createSupabaseServiceClient();
    const bundle = await generateAuditAds(service, {
      website,
      name,
      postcode,
      suburb: (body.suburb ?? "").trim() || gap.suburb,
      concepts: gap.concepts,
    });
    return NextResponse.json({ ...bundle, observedAds: gap.observedAds });
  } catch (error) {
    console.error("audit ad generation failed", error);
    return NextResponse.json(
      { error: "We could not build your ads. Check the website address and try again." },
      { status: 502 },
    );
  }
}

function connectionKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
  return `ip:${ip}`;
}
