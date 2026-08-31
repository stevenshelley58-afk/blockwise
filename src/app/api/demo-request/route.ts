import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { sendDemoRequestNotification } from "@/lib/notify/demo-request-email";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  agency: z.string().trim().max(160).optional().or(z.literal("")),
  email: z.string().trim().email("Enter a valid email").max(200),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  suburb: z.string().trim().max(120).optional().or(z.literal("")),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
  // Honeypot: real users never fill this hidden field.
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

  // Honeypot tripped — pretend success so bots do not learn anything.
  if (parsed.data.company_website) {
    return NextResponse.json({ ok: true });
  }

  // Rate limit by IP: 5 demo requests per hour per IP.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const serviceClient = createSupabaseServiceClient();
  const rateLimit = await checkRateLimit(null, ip, {
    windowSeconds: 3600,
    maxRequests: 5,
    bucket: "demo-request",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const { data: inserted, error } = await serviceClient.from("demo_requests").insert({
    name: parsed.data.name,
    agency: clean(parsed.data.agency),
    email: parsed.data.email,
    phone: clean(parsed.data.phone),
    suburb: clean(parsed.data.suburb),
    message: clean(parsed.data.message),
    source: "landing",
    user_agent: request.headers.get("user-agent"),
    referrer: request.headers.get("referer"),
  }).select("id").single();

  if (error) {
    console.error("demo-request insert failed", error);
    return NextResponse.json(
      { error: "Could not save your request. Please email hello@blockwise.sale." },
      { status: 500 },
    );
  }

  const notification = await sendDemoRequestNotification({
    name: parsed.data.name,
    email: parsed.data.email,
    agency: clean(parsed.data.agency),
    phone: clean(parsed.data.phone),
    suburb: clean(parsed.data.suburb),
    message: clean(parsed.data.message),
  });
  const { error: notificationUpdateError } = await serviceClient
    .from("demo_requests")
    .update({
      operator_notification_status: notification.sent ? "sent" : "failed",
      operator_notified_at: notification.sent ? new Date().toISOString() : null,
      operator_notification_error: notification.error,
      operator_notification_message_id: notification.messageId,
    })
    .eq("id", inserted.id);
  if (notificationUpdateError) {
    console.error("demo-request notification status update failed", notificationUpdateError);
  }
  if (!notification.sent) {
    console.error("demo-request notification failed", notification.error);
  }

  return NextResponse.json({ ok: true });
}
