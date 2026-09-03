import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { featureDisabledResponse } from "@/lib/auth/api-guards";
import {
  sendAuditCampaignPlanEmail,
  sendDemoRequestNotification,
} from "@/lib/notify/demo-request-email";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getClientIp } from "@/lib/client-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  name: z.string().trim().max(120).optional().or(z.literal("")),
  email: z.string().trim().email("Enter a valid email").max(200),
  agency: z.string().trim().max(160).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  location: z.string().trim().max(120).optional().or(z.literal("")),
  goal: z.string().trim().max(60).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  source: z.string().trim().max(40).optional().or(z.literal("")),
  detected_ads: z.coerce.number().int().min(0).max(100000).optional(),
  active_ads: z.coerce.number().int().min(0).max(100000).optional(),
  advertisers: z.coerce.number().int().min(0).max(100000).optional(),
  top_platform: z.string().trim().max(60).optional().or(z.literal("")),
  top_format: z.string().trim().max(60).optional().or(z.literal("")),
  top_angles: z.string().trim().max(200).optional().or(z.literal("")),
  company_website: z.string().max(200).optional().or(z.literal("")),
});

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function POST(request: NextRequest) {
  const featureGate = featureDisabledResponse("suburbPages");
  if (featureGate) return featureGate;

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

  const ip = getClientIp(request.headers);

  const supabase = createSupabaseServiceClient();

  const rateLimit = await checkRateLimit(null, ip, {
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
  const goal = clean(parsed.data.goal);
  const notes = clean(parsed.data.notes);
  const source = clean(parsed.data.source) ?? "audit-pdf";
  const name = clean(parsed.data.name) ?? clean(parsed.data.agency) ?? "Audit lead";

  const auditContext = [
    parsed.data.detected_ads != null ? `${parsed.data.detected_ads} ads detected` : null,
    parsed.data.active_ads != null ? `${parsed.data.active_ads} active` : null,
    parsed.data.advertisers != null ? `${parsed.data.advertisers} advertisers` : null,
    clean(parsed.data.top_platform) ? `platform ${clean(parsed.data.top_platform)}` : null,
    clean(parsed.data.top_format) ? `format ${clean(parsed.data.top_format)}` : null,
    clean(parsed.data.top_angles) ? `angles ${clean(parsed.data.top_angles)}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const message =
    [
      goal ? `Goal: ${goal}` : null,
      notes,
      location ? `Area: ${location}` : null,
      auditContext ? `Audit: ${auditContext}` : null,
    ]
      .filter(Boolean)
      .join(" | ") || (location ? `Free ad audit - ${location}` : "Free ad audit");

  const { data: inserted, error } = await supabase.from("demo_requests").insert({
    name,
    agency: clean(parsed.data.agency),
    email: parsed.data.email,
    phone: clean(parsed.data.phone),
    suburb: location,
    message,
    source,
    user_agent: request.headers.get("user-agent"),
    referrer: request.headers.get("referer"),
    customer_email_status: "pending",
  }).select("id").single();

  if (error) {
    console.error("audit-lead insert failed", error);
    return NextResponse.json({ error: "Could not save your details. Please try again." }, { status: 500 });
  }

  const reportUrl = new URL("/audit", request.url);
  if (location) reportUrl.searchParams.set("location", location);
  const [customerEmail, operatorNotification] = await Promise.all([
    sendAuditCampaignPlanEmail({
      name,
      email: parsed.data.email,
      agency: clean(parsed.data.agency),
      phone: clean(parsed.data.phone),
      suburb: location,
      message,
      goal,
      detectedAds: parsed.data.detected_ads,
      activeAds: parsed.data.active_ads,
      advertisers: parsed.data.advertisers,
      topPlatform: clean(parsed.data.top_platform),
      topFormat: clean(parsed.data.top_format),
      topAngles: clean(parsed.data.top_angles),
      reportUrl: reportUrl.toString(),
      demoRequestId: inserted.id,
    }),
    sendDemoRequestNotification({
      name,
      email: parsed.data.email,
      agency: clean(parsed.data.agency),
      phone: clean(parsed.data.phone),
      suburb: location,
      message,
      demoRequestId: inserted.id,
    }),
  ]);
  const { error: deliveryUpdateError } = await supabase
    .from("demo_requests")
    .update({
      customer_email_status: customerEmail.sent ? "sent" : customerEmail.queued ? "queued" : "failed",
      customer_emailed_at: customerEmail.sent ? new Date().toISOString() : null,
      customer_email_error: customerEmail.error,
      customer_email_message_id: customerEmail.sent ? customerEmail.messageId : null,
      operator_notification_status: operatorNotification.sent ? "sent" : operatorNotification.queued ? "queued" : "failed",
      operator_notified_at: operatorNotification.sent ? new Date().toISOString() : null,
      operator_notification_error: operatorNotification.error,
      operator_notification_message_id: operatorNotification.sent ? operatorNotification.messageId : null,
    })
    .eq("id", inserted.id);
  if (deliveryUpdateError) {
    console.error("audit-lead delivery status update failed", deliveryUpdateError);
  }
  if (!operatorNotification.sent && !operatorNotification.queued) {
    console.error("audit-lead operator notification failed", operatorNotification.error);
  }
  if (!customerEmail.sent && !customerEmail.queued) {
    console.error("audit-lead customer email failed", customerEmail.error);
    return NextResponse.json(
      { error: "We saved your request but could not send the plan. Please try again shortly." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
