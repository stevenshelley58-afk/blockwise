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

    const { error } = await supabase.from("report_email_leads").insert({
      email: parsed.data.email.toLowerCase(),
      postcode: parsed.data.postcode,
      suburb: parsed.data.suburb,
      source: "suburb-report",
    });
    if (error) throw error;

    if (getOperatorMailboxConfig().configured) {
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://blockwise.sale";
      try {
        await sendOperatorEmail({
          to: [parsed.data.email],
          subject: `Your ${parsed.data.suburb} ad report`,
          text: [
            `Your live ${parsed.data.suburb} ad report is ready.`,
            `${baseUrl}/suburb/${parsed.data.postcode}`,
            "The report stays free and updates as the observed ad set changes.",
          ].join("\n\n"),
        });
      } catch (sendError) {
        console.error("suburb report email delivery failed", sendError);
      }
    }

    return { ok: true };
  } catch (error) {
    console.error("suburb report email capture failed", error);
    return { ok: false, error: "We could not save that email. Please try again." };
  }
}
