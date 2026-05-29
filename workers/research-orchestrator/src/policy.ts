import type { SupabaseClient } from "@supabase/supabase-js";

import type { OrchestratorEnv } from "./env.ts";

export type DuePage = {
  agencyIdForMatches: string | null;
  agentIdForMatches: string | null;
  suburb: string | null;
  advertiserPageId: string;
  platform: "facebook" | "instagram" | "meta_ad_library";
  pageId: string;
  pageName: string;
  pageUrl: string | null;
  postcode: string;
  state: string;
  priority: number;
  refreshCadenceMinutes: number;
  lastCheckedAt: string | null;
};

/**
 * Find advertiser pages that are due for a refresh according to their
 * postcode's refresh policy. Priority 1 first, then 2, ... Cap at
 * MAX_PAGES_PER_TICK.
 *
 * "Due" = (last_checked_at is null) OR (now - last_checked_at >= cadence).
 * Inactive policies are skipped.
 */
export async function listDuePages(
  supabase: SupabaseClient,
  env: OrchestratorEnv,
): Promise<DuePage[]> {
  // Pull the candidate set: any advertiser_page with a service area whose
  // refresh_policy is active. Join via agent_service_areas (an agent or
  // agency that the page belongs to must cover a postcode that has a
  // policy). For v1 we approximate: pick all advertiser_pages with status
  // = 'resolved' and join to their best-matching policy.

  const research = supabase.schema("research");

  if (env.ORCHESTRATOR_TARGET_PAGE_ID) {
    const forced = await loadTargetPage(research, env.ORCHESTRATOR_TARGET_PAGE_ID);
    return forced ? [forced] : [];
  }

  // Pull resolved advertiser_pages and the most-relevant policy for each
  // (highest priority among postcodes the page's agent/agency serves).
  const { data, error } = await research.rpc("orchestrator_list_due_pages", {
    max_pages: env.ORCHESTRATOR_MAX_PAGES_PER_TICK,
  });

  if (!error && Array.isArray(data) && data.length > 0) {
    return data.map(rowToDuePage);
  }

  // Fallback when the RPC isn't installed yet: simpler query using two
  // separate fetches and a join in app code.
  const { data: pages, error: pagesErr } = await research
    .from("advertiser_pages")
    .select("id, platform, page_id, page_name, page_url, agent_id, agency_id, last_checked_at, status, metadata")
    .eq("status", "resolved")
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(env.ORCHESTRATOR_MAX_PAGES_PER_TICK * 5);
  if (pagesErr) throw pagesErr;

  const { data: policies, error: polErr } = await research
    .from("refresh_policies")
    .select("postcode, state, priority, refresh_cadence_minutes, active");
  if (polErr) throw polErr;
  const policyByPostcode = new Map(
    (policies ?? [])
      .filter((p: { active: boolean }) => p.active)
      .map((p) => [`${p.postcode}:${p.state}`, p]),
  );

  const due: DuePage[] = [];
  const now = Date.now();
  for (const page of pages ?? []) {
    const areaQ = await research
      .from("agent_service_areas")
      .select("postcode, suburb, state")
      .or(
        `agent_id.eq.${page.agent_id ?? "00000000-0000-0000-0000-000000000000"},agency_id.eq.${page.agency_id ?? "00000000-0000-0000-0000-000000000000"}`,
      )
      .limit(5);
    const areas = (areaQ.data ?? []) as Array<{ postcode: string; suburb: string | null; state: string }>;
    const metadataArea = areaFromMetadata(page.metadata);
    if (areas.length === 0 && metadataArea) areas.push(metadataArea);
    let best: DuePage | null = null;
    for (const a of areas) {
      const p = policyByPostcode.get(`${a.postcode}:${a.state}`);
      if (!p) continue;
      const overdueBy = page.last_checked_at
        ? now - new Date(page.last_checked_at).getTime() - p.refresh_cadence_minutes * 60_000
        : Number.POSITIVE_INFINITY;
      if (overdueBy < 0) continue;
      const candidate: DuePage = {
        agencyIdForMatches: (page.agency_id ?? null) as string | null,
        agentIdForMatches: (page.agent_id ?? null) as string | null,
        suburb: a.suburb ?? null,
        advertiserPageId: page.id,
        platform: page.platform,
        pageId: page.page_id,
        pageName: page.page_name,
        pageUrl: page.page_url,
        postcode: a.postcode,
        state: a.state,
        priority: p.priority,
        refreshCadenceMinutes: p.refresh_cadence_minutes,
        lastCheckedAt: page.last_checked_at,
      };
      if (!best || candidate.priority < best.priority) best = candidate;
    }
    if (best) due.push(best);
  }

  due.sort((a, b) => a.priority - b.priority);
  return due.slice(0, env.ORCHESTRATOR_MAX_PAGES_PER_TICK);
}

function areaFromMetadata(value: unknown): { postcode: string; suburb: string | null; state: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  const postcode = metadata.postcode;
  if (typeof postcode !== "string" && typeof postcode !== "number") return null;
  return {
    postcode: String(postcode),
    suburb: typeof metadata.suburb === "string" ? metadata.suburb : null,
    state: typeof metadata.state === "string" ? metadata.state : "WA",
  };
}

async function loadTargetPage(
  research: ReturnType<SupabaseClient["schema"]>,
  targetPageId: string,
): Promise<DuePage | null> {
  const { data: page, error } = await research
    .from("advertiser_pages")
    .select("id, platform, page_id, page_name, page_url, agent_id, agency_id, last_checked_at, status")
    .or(isUuid(targetPageId) ? `id.eq.${targetPageId},page_id.eq.${targetPageId}` : `page_id.eq.${targetPageId}`)
    .eq("status", "resolved")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!page) return null;

  const areaQ = await research
    .from("agent_service_areas")
    .select("postcode, suburb, state")
    .or(
      `agent_id.eq.${page.agent_id ?? "00000000-0000-0000-0000-000000000000"},agency_id.eq.${page.agency_id ?? "00000000-0000-0000-0000-000000000000"}`,
    )
    .limit(1);
  if (areaQ.error) throw areaQ.error;
  const area = (areaQ.data?.[0] ?? { postcode: "6000", suburb: null, state: "WA" }) as {
    postcode: string;
    suburb: string | null;
    state: string;
  };

  return {
    agencyIdForMatches: (page.agency_id ?? null) as string | null,
    agentIdForMatches: (page.agent_id ?? null) as string | null,
    suburb: area.suburb ?? null,
    advertiserPageId: page.id,
    platform: page.platform,
    pageId: page.page_id,
    pageName: page.page_name,
    pageUrl: page.page_url,
    postcode: area.postcode,
    state: area.state,
    priority: 0,
    refreshCadenceMinutes: 0,
    lastCheckedAt: page.last_checked_at,
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function rowToDuePage(row: Record<string, unknown>): DuePage {
  return {
    agencyIdForMatches: (row.agency_id ?? null) as string | null,
    agentIdForMatches: (row.agent_id ?? null) as string | null,
    suburb: (row.suburb ?? null) as string | null,
    advertiserPageId: row.advertiser_page_id as string,
    platform: row.platform as DuePage["platform"],
    pageId: row.page_id as string,
    pageName: row.page_name as string,
    pageUrl: (row.page_url ?? null) as string | null,
    postcode: row.postcode as string,
    state: (row.state ?? "WA") as string,
    priority: (row.priority ?? 3) as number,
    refreshCadenceMinutes: (row.refresh_cadence_minutes ?? 1440) as number,
    lastCheckedAt: (row.last_checked_at ?? null) as string | null,
  };
}
