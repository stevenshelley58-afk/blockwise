import { resolveAdRadarLocationSearch } from "@/lib/research/ad-radar-location";
import { hasEnabledCensusSourceForState } from "@/lib/research/census-sources";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type ResearchSupabase = ReturnType<ReturnType<typeof createSupabaseServiceClient>["schema"]>;

export type PostcodeRefreshResult = {
  postcode: string;
  state: string;
  sourceBacked: boolean;
  queued: boolean;
  message: string;
};

export function inferPostcodeRefreshState(postcode: string): string {
  return resolveAdRadarLocationSearch(postcode)?.stateCode ?? "WA";
}

export function isSourceBackedPostcodeRefreshState(state: string): boolean {
  return hasEnabledCensusSourceForState(state);
}

export function unsupportedPostcodeRefreshMessage(postcode: string, state: string): string {
  return `No census source for ${state} yet, so I did not queue a postcode census refresh for ${postcode}.`;
}

export async function executeRefreshPostcode(
  research: ResearchSupabase,
  postcode: string,
  operatorEmail: string,
): Promise<PostcodeRefreshResult> {
  const state = inferPostcodeRefreshState(postcode);
  const sourceBacked = isSourceBackedPostcodeRefreshState(state);
  const policyError = await markPostcodeRefreshDue(research, postcode, state, sourceBacked);
  if (policyError) throw policyError;

  const actionError = sourceBacked
    ? await queuePostcodeCensusRefresh(research, postcode, state)
    : await recordUnsupportedPostcodeRefresh(research, postcode, state, operatorEmail);
  if (actionError) throw actionError;

  return {
    postcode,
    state,
    sourceBacked,
    queued: sourceBacked,
    message: sourceBacked
      ? `Queued postcode census refresh for ${postcode} ${state}.`
      : unsupportedPostcodeRefreshMessage(postcode, state),
  };
}

async function markPostcodeRefreshDue(
  research: ResearchSupabase,
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
  research: ResearchSupabase,
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
  research: ResearchSupabase,
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
