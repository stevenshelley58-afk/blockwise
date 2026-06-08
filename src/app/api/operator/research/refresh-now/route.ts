import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOperator } from "@/lib/operator/auth";
import { resolveAdRadarLocationSearch } from "@/lib/research/ad-radar-location";
import { hasEnabledCensusSourceForState } from "@/lib/research/census-sources";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  scope: z.enum(["postcode", "advertiser_page"]),
  value: z.string().min(1),
});

async function parseBody(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return { body: await req.json(), redirectAfter: false };
  }

  const formData = await req.formData();
  return {
    body: Object.fromEntries(formData.entries()),
    redirectAfter: true,
  };
}

function inferPostcodeState(postcode: string): string {
  return resolveAdRadarLocationSearch(postcode)?.stateCode ?? "WA";
}

async function markPostcodeRefreshDue(
  research: ReturnType<ReturnType<typeof createSupabaseServiceClient>["schema"]>,
  postcode: string,
  state: string,
  sourceBacked: boolean,
) {
  const nextRefreshAt = sourceBacked
    ? new Date().toISOString()
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const notes = sourceBacked
    ? "Operator triggered immediate refresh"
    : `Operator requested refresh, but no enabled census source is configured for ${state}`;

  const { error: createError } = await research
    .from("refresh_policies")
    .upsert(
      {
        postcode,
        state,
        priority: state === "WA" ? 2 : 4,
        refresh_cadence_minutes: 1440,
        next_refresh_at: nextRefreshAt,
        active: true,
        notes,
      },
      { onConflict: "postcode,state", ignoreDuplicates: true },
    );
  if (createError) return createError;

  const { error: updateError } = await research
    .from("refresh_policies")
    .update({ next_refresh_at: nextRefreshAt, notes })
    .eq("postcode", postcode)
    .eq("state", state);
  return updateError;
}

async function recordUnsupportedPostcodeRefresh(
  research: ReturnType<ReturnType<typeof createSupabaseServiceClient>["schema"]>,
  postcode: string,
  state: string,
  operatorEmail: string,
) {
  const { data: existing, error: loadError } = await research
    .from("coverage_defects")
    .select("id")
    .eq("postcode", postcode)
    .eq("state", state)
    .in("status", ["open", "investigating", "blocked"])
    .limit(1)
    .maybeSingle();
  if (loadError) return loadError;
  if (existing) return null;

  const { error } = await research.from("coverage_defects").insert({
    postcode,
    state,
    notes: `Operator requested refresh for ${postcode} ${state}, but no enabled census source is configured for ${state}.`,
    reported_by: "operator",
    reporter_identity: operatorEmail,
    status: "blocked",
    resolution: {
      reason: "missing_census_source",
      source: "operator_refresh_now",
      location_search_allowed: false,
    },
  });
  return error;
}

async function queuePostcodeCensusRefresh(
  research: ReturnType<ReturnType<typeof createSupabaseServiceClient>["schema"]>,
  postcode: string,
  state: string,
) {
  const dedupeKey = `census:${state}:${postcode}`;
  const payload = {
    postcode,
    state,
    verified_roster_first: true,
    location_search_allowed: false,
    legacy_discovery_allowed: false,
    trigger: "operator_refresh_now",
  };

  const { data: existing, error: loadError } = await research
    .from("work_queue")
    .select("id,status,claim_expires_at")
    .eq("queue_name", "research")
    .eq("dedupe_key", dedupeKey)
    .in("status", ["pending", "claimed", "failed", "blocked"])
    .limit(1)
    .maybeSingle();
  if (loadError) return loadError;

  if (existing) {
    const staleClaim =
      existing.status === "claimed" &&
      existing.claim_expires_at !== null &&
      new Date(String(existing.claim_expires_at)).getTime() < Date.now();
    if (existing.status === "pending" || (existing.status === "claimed" && !staleClaim)) return null;

    const { error: updateError } = await research
      .from("work_queue")
      .update({
        queue_name: "research",
        job_type: "blockwise-agent-census",
        advertiser_page_id: null,
        priority: 15,
        payload,
        status: "pending",
        available_at: new Date().toISOString(),
        claimed_at: null,
        claimed_by: null,
        claim_token: null,
        claim_expires_at: null,
        attempts: 0,
        max_attempts: 3,
        last_error: null,
        blocked_reason: null,
        result: {},
        completed_at: null,
      })
      .eq("id", existing.id);
    return updateError;
  }

  const { error } = await research.from("work_queue").insert({
    queue_name: "research",
    job_type: "blockwise-agent-census",
    dedupe_key: dedupeKey,
    priority: 15,
    payload,
    status: "pending",
    max_attempts: 3,
  });

  if (error && !/duplicate key|work_queue_active_dedupe_idx/iu.test(error.message)) return error;
  return null;
}

/**
 * POST /api/operator/research/refresh-now
 * Signals Hermes to refresh a specific postcode or page. Postcode refreshes
 * create a source-backed due policy and a one-off census job, recycling
 * failed/blocked dedupe keys so manual repair still works when the scheduler
 * is paused. Unsupported states are recorded as visible coverage defects.
 */
export async function POST(req: Request) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { body, redirectAfter } = await parseBody(req);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { scope, value } = parsed.data;

  const research = createSupabaseServiceClient().schema("research");

  if (scope === "postcode") {
    const postcode = value.trim();
    if (!/^\d{4}$/u.test(postcode)) {
      return NextResponse.json({ error: "postcode must be four digits" }, { status: 400 });
    }
    const state = inferPostcodeState(postcode);
    const sourceBacked = hasEnabledCensusSourceForState(state);
    const error = await markPostcodeRefreshDue(research, postcode, state, sourceBacked)
      ?? (sourceBacked
        ? await queuePostcodeCensusRefresh(research, postcode, state)
        : await recordUnsupportedPostcodeRefresh(research, postcode, state, guard.email));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await research
      .from("advertiser_pages")
      .update({ last_checked_at: null })
      .eq("id", value);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Audit the operator action.
  await research.from("agent_decisions").insert({
    decision_type: "cadence_change",
    subject_type: scope === "postcode" ? "postcode" : "advertiser_page",
    subject_id: value,
    decision: { action: "refresh_now", operator: guard.email },
    rationale: "Operator triggered immediate refresh",
    confidence: 100,
    hermes_skill: "operator-console",
  });

  if (redirectAfter) {
    return NextResponse.redirect(new URL("/operator/research", req.url), 303);
  }

  return NextResponse.json({ ok: true });
}
