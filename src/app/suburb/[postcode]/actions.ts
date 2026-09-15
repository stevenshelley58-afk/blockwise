"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const reportLeadSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  postcode: z.string().regex(/^\d{4}$/, "Invalid postcode."),
  suburb: z.string().trim().min(1).max(120),
});

export type ReportRequestState = { ok: boolean; error?: string };

export async function saveSuburbReportRequest(
  _previous: ReportRequestState,
  formData: FormData,
): Promise<ReportRequestState> {
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
    const rateLimit = await checkRateLimit(null, subjectKey, {
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

    return { ok: true };
  } catch (error) {
    console.error("suburb report request capture failed", error);
    return { ok: false, error: "We could not save that email. Please try again." };
  }
}
