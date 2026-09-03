import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { sendDemoRequestNotification } from "@/lib/notify/demo-request-email";
import { enqueueEmail } from "@/lib/email/outbox";
import { escapeHtml } from "@/lib/email/provider";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getClientIp } from "@/lib/client-ip";
import { redactString } from "@/lib/redact";

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
  company_website: z.string().max(200).optional().or(z.literal("")),
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
  const ip = getClientIp(request.headers);
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
    lead_welcome_enqueue_status: "pending",
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
    demoRequestId: inserted.id,
  });
  const { error: notificationUpdateError } = await serviceClient
    .from("demo_requests")
    .update({
      operator_notification_status: notification.sent ? "sent" : notification.queued ? "queued" : "failed",
      operator_notified_at: notification.sent ? new Date().toISOString() : null,
      operator_notification_error: notification.error,
      operator_notification_message_id: notification.sent ? notification.messageId : null,
    })
    .eq("id", inserted.id);
  if (notificationUpdateError) {
    console.error("demo-request notification status update failed", notificationUpdateError);
  }
  if (!notification.sent) {
    console.error("demo-request notification failed", notification.error);
  }

  // Queue the lead welcome after the request commit. If this process crashes
  // in the gap, the drain scanner retries rows left in pending/failed state.
  let leadWelcomeQueued = false;
  try {
    const firstName = parsed.data.name.split(/\s+/)[0] || "there";
    await enqueueEmail(serviceClient, {
      messageType: "lead_welcome",
      templateId: "lead-welcome",
      templateVersion: 1,
      to: parsed.data.email,
      from: process.env.DEMO_NOTIFY_FROM?.trim() || "hello@blockwise.sale",
      replyTo: "support@blockwise.sale",
      subject: "Your Blockwise demo request — what happens next",
      html: `<p>Hi ${escapeHtml(firstName)},</p><p>Thanks for requesting a demo. The Blockwise team has your details and will be in touch within one business day.</p><p>— Blockwise</p>`,
      text: `Hi ${firstName},\n\nThanks for requesting a demo. The Blockwise team has your details and will be in touch within one business day.\n\n— Blockwise`,
      payload: { demoRequestId: inserted.id },
      idempotencyKey: `lead-welcome:${inserted.id}`,
    });
    leadWelcomeQueued = true;
  } catch (error) {
    await serviceClient.from("demo_requests").update({ lead_welcome_enqueue_status: "failed", lead_welcome_enqueue_error: redactString(error instanceof Error ? error.message : String(error)) }).eq("id", inserted.id);
    console.error("demo-request lead welcome enqueue failed", error instanceof Error ? error.message : error);
  }
  if (leadWelcomeQueued) {
    await serviceClient.from("demo_requests").update({ lead_welcome_enqueue_status: "queued", lead_welcome_enqueue_error: null }).eq("id", inserted.id);
  }

  return NextResponse.json({ ok: true });
}
