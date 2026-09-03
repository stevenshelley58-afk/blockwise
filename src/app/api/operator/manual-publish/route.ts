import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/operator/auth";
import { listManualPublishRequests, ManualPublishError } from "@/lib/adstudio/manual-publish";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  try {
    const requests = await listManualPublishRequests(createSupabaseServiceClient());
    return NextResponse.json({ requests: requests.filter((request) => !["completed", "cancelled"].includes(request.status)) });
  } catch (error) {
    if (error instanceof ManualPublishError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("Manual publish queue failed", error);
    return NextResponse.json({ error: "Manual publishing queue failed." }, { status: 500 });
  }
}
