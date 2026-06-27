import { NextResponse, type NextRequest } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const DISPLAY_STATES = new Set(["pending_review", "displayable", "hidden", "blocked", "archived"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const input = await parseDisplayStateInput(request);
  if (!DISPLAY_STATES.has(input.displayState)) {
    return respond(request, { error: "Invalid display state." }, 400);
  }

  const patch = {
    display_state: input.displayState,
  };
  const research = createSupabaseServiceClient().schema("research");

  let { data: creative, error } = await research
    .from("ad_creatives")
    .update(patch)
    .eq("observed_ad_id", id)
    .select("id,observed_ad_id,display_state")
    .maybeSingle();

  if (!creative && !error) {
    const result = await research
      .from("ad_creatives")
      .update(patch)
      .eq("id", id)
      .select("id,observed_ad_id,display_state")
      .maybeSingle();
    creative = result.data;
    error = result.error;
  }

  if (error) return respond(request, { error: error.message }, 500);
  if (!creative) return respond(request, { error: "Creative not found." }, 404);

  await research.from("ingest_events").insert({
    event_type: "update",
    table_name: "ad_creatives",
    row_id: creative.id,
    source_provider: "operator",
    payload: {
      display_state: input.displayState,
      reason: input.reason,
      updated_by: guard.email,
      observed_ad_id: creative.observed_ad_id,
    },
  });

  return respond(request, { creative });
}

async function parseDisplayStateInput(request: NextRequest): Promise<{ displayState: string; reason: string | null }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    return {
      displayState: String(body.displayState ?? body.display_state ?? ""),
      reason: cleanString(body.reason),
    };
  }

  const form = await request.formData();
  return {
    displayState: String(form.get("displayState") ?? form.get("display_state") ?? ""),
    reason: cleanString(form.get("reason")),
  };
}

function respond(request: NextRequest, body: Record<string, unknown>, status = 200) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    if (status >= 400) return NextResponse.json(body, { status });
    return NextResponse.redirect(new URL("/operator/research", request.url), 303);
  }
  return NextResponse.json(body, { status });
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
