import { NextResponse } from "next/server";

import { verifyInternalRequest } from "@/lib/internal-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { formGenerationInputSchema } from "@/lib/adstudio/instant-form-types";
import { generateInstantForm, validateInstantForm } from "@/lib/adstudio/instant-form-generator";

/**
 * POST /api/internal/adstudio/instant-forms/generate
 *
 * AI-assisted Instant Form generator. Uses deterministic rules + template-based
 * wording (Phase 7.1 stub — real AI in production via cheapest capable text model).
 *
 * Internal-only: requires the BLOCKWISE_INTERNAL_SECRET HMAC headers
 * (scope "adstudio.instant-forms").
 *
 * Request: FormGenerationInput
 * Response: { form: InstantForm, issues: ValidationIssue[] }
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const auth = await verifyInternalRequest(request, "adstudio.instant-forms", { body: rawBody });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const rateLimit = await checkRateLimit(null, "internal:adstudio.instant-forms", {
    windowSeconds: 60,
    maxRequests: 120,
    bucket: "internal-api",
    failClosed: true,
  });
  if (!rateLimit.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = formGenerationInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
  }

  const { form, issues } = generateInstantForm(parsed.data);

  return NextResponse.json({ form, issues }, { status: 200 });
}

/**
 * PUT /api/internal/adstudio/instant-forms/validate
 *
 * Validates an Instant Form against Meta requirements without regenerating.
 * Internal-only: requires the BLOCKWISE_INTERNAL_SECRET HMAC headers
 * (scope "adstudio.instant-forms").
 */
export async function PUT(request: Request) {
  const rawBody = await request.text();
  const auth = await verifyInternalRequest(request, "adstudio.instant-forms", { body: rawBody });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const rateLimit = await checkRateLimit(null, "internal:adstudio.instant-forms", {
    windowSeconds: 60,
    maxRequests: 120,
    bucket: "internal-api",
    failClosed: true,
  });
  if (!rateLimit.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { instantFormSchema } = await import("@/lib/adstudio/instant-form-types");
  const parsed = instantFormSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_form", issues: parsed.error.issues }, { status: 400 });
  }

  const issues = validateInstantForm(parsed.data);
  return NextResponse.json({ form: parsed.data, issues }, { status: 200 });
}
