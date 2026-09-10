"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { recordEmailSuppression } from "@/lib/email/outbox";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export async function unsubscribeEmail(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect("/preferences/unsubscribe?error=check");
  }

  const requestHeaders = await headers();
  const subjectKey = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
  const rateLimit = await checkRateLimit(null, subjectKey, {
    bucket: "unsubscribe-self-serve",
    maxRequests: 10,
    windowSeconds: 3600,
  });
  if (!rateLimit.ok) redirect("/preferences/unsubscribe?error=rate");

  const supabase = createSupabaseServiceClient();
  try {
    await recordEmailSuppression(supabase, {
      email,
      reason: "unsubscribe",
      source: "self_serve_preferences",
    });
  } catch (error) {
    console.error("unsubscribe failed", error);
    redirect("/preferences/unsubscribe?error=failed");
  }
  redirect("/preferences/unsubscribe?done=1");
}
