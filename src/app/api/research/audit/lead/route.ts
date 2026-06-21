import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { sendDemoRequestNotification } from "@/lib/notify/demo-request-email";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email("Enter a valid email").max(200),
  agency: z.string().trim().max(160).optional().or(z.literal("")),
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
    bucket: "audit-lead",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const location = clean(parsed.data.location);
  const { error } = await supabase.from("demo_requests").insert({
    name: parsed.data.name,
    agency: clean(parsed.data.agency),
    email: parsed.data.email,
    suburb: location,
    message: location ? `Free ad audit PDF download — ${location}` : "Free ad audit PDF download",
    source: "audit-pdf",
    user_agent: request.headers.get("user-agent"),
    referrer: request.headers.get("referer"),
  });

  if (error) {
    console.error("audit-lead insert failed", error);
    return NextResponse.json({ error: "Could not save your details. Please try again." }, { status: 500 });
  }

  try {
    await sendDemoRequestNotification({
      name: parsed.data.name,
      email: parsed.data.email,
      agency: clean(parsed.data.agency),
      suburb: location,
      message: location ? `Free ad audit PDF download — ${location}` : "Free ad audit PDF download",
    });
  } catch (notifyError) {
    console.error("audit-lead notification failed", notifyError);
  }

  return NextResponse.json({ ok: true });
}
