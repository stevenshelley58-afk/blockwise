import { NextResponse } from "next/server";

import { loadPublicOutreachReport } from "@/lib/outreach/repository";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public-safe report data. The opaque token is not an authentication session. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const report = await loadPublicOutreachReport(createSupabaseServiceClient(), token);
  if (!report) {
    return NextResponse.json(
      { error: "report_not_found" },
      { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" } },
    );
  }
  return NextResponse.json(report, {
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" },
  });
}

