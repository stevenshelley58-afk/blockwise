"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { getOperatorMailboxConfig, sendOperatorEmail } from "@/lib/operator/email-service";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const reportLeadSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  postcode: z.string().regex(/^\d{4}$/, "Invalid postcode."),
  suburb: z.string().trim().min(1).max(120),
});

export type ReportEmailState = { ok: boolean; error?: string };

export async function emailSuburbReport(
  _previous: ReportEmailState,
  formData: FormData,
): Promise<ReportEmailState> {
  const parsed = reportLeadSchema.safeParse({
    email: formData.get("email"),
    postcode: formData.get("postcode"),
    suburb: formData.get("suburb"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your email address." };

  try {
    const supabase = createSupabaseServiceClient();
    const requestHeaders = await headers();
    const subjectKey = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
    const rateLimit = await checkRateLimit(supabase, null, subjectKey, {
      bucket: "suburb-report-email",
      maxRequests: 5,
      windowSeconds: 3600,
    });
    if (!rateLimit.ok) return { ok: false, error: "Too many requests. Try again a little later." };

    const { data: lead, error } = await supabase.from("report_email_leads").insert({
      email: parsed.data.email.toLowerCase(),
      postcode: parsed.data.postcode,
      suburb: parsed.data.suburb,
      source: "suburb-report",
    }).select("id").single();
    if (error) throw error;

    if (!getOperatorMailboxConfig().configured) {
      await markReportEmailFailed(supabase, lead.id, "Report email is not configured.");
      return { ok: false, error: "Email delivery is temporarily unavailable. Please use the live report link." };
    }

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://blockwise.sale";
    try {
      const delivery = await sendOperatorEmail({
        to: [parsed.data.email],
        subject: `Your ${parsed.data.suburb} ad report`,
        text: [
          `Your live ${parsed.data.suburb} ad report is ready.`,
          `${baseUrl}/suburb/${parsed.data.postcode}`,
          "The report stays free and updates as the observed ad set changes.",
        ].join("\n\n"),
      });
      const { error: deliveryUpdateError } = await supabase
        .from("report_email_leads")
        .update({
          delivery_status: "sent",
          delivered_at: new Date().toISOString(),
          delivery_message_id: delivery.id,
          delivery_error: null,
        })
        .eq("id", lead.id);
      if (deliveryUpdateError) throw deliveryUpdateError;
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : "Email delivery failed.";
      await markReportEmailFailed(supabase, lead.id, message);
      console.error("suburb report email delivery failed", sendError);
      return { ok: false, error: "We saved your email but could not send the report. Please try again." };
    }

    return { ok: true };
  } catch (error) {
    console.error("suburb report email capture failed", error);
    return { ok: false, error: "We could not save that email. Please try again." };
  }
}

async function markReportEmailFailed(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  id: string,
  message: string,
) {
  const { error } = await supabase
    .from("report_email_leads")
    .update({ delivery_status: "failed", delivery_error: message.slice(0, 500) })
    .eq("id", id);
  if (error) console.error("suburb report delivery status update failed", error);
}
