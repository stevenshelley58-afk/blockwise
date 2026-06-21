import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(200),
  location: z.string().trim().max(120).optional().or(z.literal("")),
  company_website: z.string().max(0).optional().or(z.literal("")),
});

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid submission." },
      { status: 400 },
    );
  }

  // Honeypot tripped - pretend success so bots do not learn anything.
  if (parsed.data.company_website) {
    return NextResponse.json({ ok: true });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const supabase = createSupabaseServiceClient();

  const rateLimit = await checkRateLimit(supabase, null, ip, {
    windowSeconds: 3600,
    maxRequests: 8,
    bucket: "audit-snapshot",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const location = clean(parsed.data.location);
  const name = parsed.data.email.split("@")[0]?.slice(0, 80) || "Snapshot subscriber";
  const { error } = await supabase.from("demo_requests").insert({
    name,
    email: parsed.data.email,
    suburb: location,
    message: location ? `Future ad snapshots - ${location}` : "Future ad snapshots subscription",
    source: "audit-snapshot",
    user_agent: request.headers.get("user-agent"),
    referrer: request.headers.get("referer"),
  });

  if (error) {
    console.error("audit-snapshot insert failed", error);
    return NextResponse.json({ error: "Could not save your details. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
