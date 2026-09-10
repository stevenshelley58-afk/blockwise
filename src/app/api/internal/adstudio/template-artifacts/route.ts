import { NextResponse, type NextRequest } from "next/server";

import { ingestTemplateArtifact } from "@/lib/adstudio/ingest-artifact";
import { verifyInternalRequest } from "@/lib/internal-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const auth = await verifyInternalRequest(request, "adstudio.templates", { body: rawBody });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const rateLimit = await checkRateLimit(null, "internal:adstudio.templates", {
    windowSeconds: 60,
    maxRequests: 120,
    bucket: "internal-api",
    failClosed: true,
  });
  if (!rateLimit.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } });
  }
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  try {
    const result = await ingestTemplateArtifact(createSupabaseServiceClient(), body);
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "template_artifact_failed";
    const status = code === "invalid_template_artifact" || code === "template_artifact_assets_mismatch" || code === "template_artifact_review_required" ? 422
      : code === "template_artifact_conflict" ? 409 : 500;
    return NextResponse.json({ error: code }, { status });
  }
}
