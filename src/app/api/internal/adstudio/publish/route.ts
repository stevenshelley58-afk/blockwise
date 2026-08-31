import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { verifyInternalRequest } from "@/lib/internal-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { loadPublishState, validatePublishState, freezePublicationSnapshot } from "@/lib/adstudio/publish-adapter";
import type { MetaConnectionSetup } from "@/lib/providers/meta-execution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/internal/adstudio/publish/state?adId=...&workspaceId=...
 *
 * Loads the authoritative publish state: ad metadata, active revision
 * PNG outputs, direct template, and latest Instant Form.
 *
 * Internal-only: requires the BLOCKWISE_INTERNAL_SECRET HMAC headers
 * (scope "adstudio.publish").
 */
export async function GET(request: Request) {
  const auth = await verifyInternalRequest(request, "adstudio.publish");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const adId = searchParams.get("adId");
  const workspaceId = searchParams.get("workspaceId");

  if (!adId || !workspaceId) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "server_configuration" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const rateLimit = await checkRateLimit(supabase, null, "internal:adstudio.publish", {
    windowSeconds: 60,
    maxRequests: 120,
    bucket: "internal-api",
    failClosed: true,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  try {
    const state = await loadPublishState(supabase, adId, workspaceId);
    const issues = validatePublishState(state);
    return NextResponse.json({ state, issues, ready: issues.length === 0 }, { status: 200 });
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    return NextResponse.json({ error: err.code ?? "load_failed", message: err.message }, { status: 500 });
  }
}

/**
 * POST /api/internal/adstudio/publish/freeze
 *
 * Freezes a publication snapshot for the given ad + revision.
 * Body: { adId, workspaceId, connectionId, setup, controls }
 *
 * Internal-only: requires the BLOCKWISE_INTERNAL_SECRET HMAC headers
 * (scope "adstudio.publish").
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const auth = await verifyInternalRequest(request, "adstudio.publish", { body: rawBody });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: {
    adId?: unknown;
    workspaceId?: unknown;
    connectionId?: unknown;
    setup?: Partial<MetaConnectionSetup>;
    controls?: Record<string, unknown>;
  } | null = null;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body.adId !== "string" || typeof body.workspaceId !== "string") {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "server_configuration" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const rateLimit = await checkRateLimit(supabase, null, "internal:adstudio.publish", {
    windowSeconds: 60,
    maxRequests: 120,
    bucket: "internal-api",
    failClosed: true,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  try {
    const state = await loadPublishState(supabase, body.adId, body.workspaceId);
    const issues = validatePublishState(state, { controls: body.controls ?? {}, setup: body.setup ?? {} });
    if (issues.length > 0) {
      return NextResponse.json({ error: "not_ready", issues }, { status: 400 });
    }

    const { snapshotId } = await freezePublicationSnapshot(supabase, {
      adId: body.adId,
      workspaceId: body.workspaceId,
      connectionId: typeof body.connectionId === "string" ? body.connectionId : "",
      setup: body.setup as MetaConnectionSetup,
      controls: body.controls ?? {},
    }, state);

    return NextResponse.json({ snapshotId, state }, { status: 201 });
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    const status = err.code === "not_saved" ? 400
      : err.code === "ad_not_found" ? 404
      : 500;
    return NextResponse.json({ error: err.code ?? "freeze_failed", message: err.message }, { status });
  }
}
