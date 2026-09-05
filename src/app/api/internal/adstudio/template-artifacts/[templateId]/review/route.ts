import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { activateTemplate, discardTemplate, smokeTestTemplate } from "@/lib/adstudio/template-review";
import { verifyInternalRequest } from "@/lib/internal-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["smoke_test", "activate", "discard"]), runId: z.string().regex(/^[A-Za-z0-9._:-]{8,200}$/), reason: z.string().trim().min(1).max(1000).optional() }).strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  const rawBody = await request.text();
  const auth = await verifyInternalRequest(request, "adstudio.templates.review", { body: rawBody });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rateLimit = await checkRateLimit(null, "internal:adstudio.templates.review", { windowSeconds: 60, maxRequests: 120, bucket: "internal-api", failClosed: true });
  if (!rateLimit.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } });
  const templateId = (await params).templateId;
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(templateId)) return NextResponse.json({ error: "invalid_template_id" }, { status: 400 });
  let input: z.infer<typeof bodySchema>;
  try { input = bodySchema.parse(JSON.parse(rawBody)); } catch { return NextResponse.json({ error: "invalid_template_review" }, { status: 400 }); }
  const service = createSupabaseServiceClient();
  try {
    if (input.action === "smoke_test") {
      const checks = await smokeTestTemplate(service, templateId, input.runId);
      return NextResponse.json({ templateId, status: "passed", checks });
    }
    if (input.action === "activate") return NextResponse.json(await activateTemplate(service, templateId, input.runId));
    return NextResponse.json(await discardTemplate(service, templateId, input.runId, input.reason));
  } catch (error) {
    const code = error instanceof Error ? error.message : "template_review_failed";
    const status = /not_found/i.test(code) ? 404 : /forbidden|exist|smoke_test_required/i.test(code) ? 409 : /invalid/i.test(code) ? 422 : 500;
    return NextResponse.json({ error: code }, { status });
  }
}
