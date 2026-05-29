import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { type DiscoveryQuery } from "./queries.ts";

const APIFY_ACTOR = "apify/facebook-ads-scraper";

/**
 * Kick off one Apify search run for a query, wait for it to complete,
 * read the dataset, and return the unique pageIds + names.
 */
async function runDiscoverySearch(q: DiscoveryQuery, token: string): Promise<Map<string, { name: string; url: string | null }>> {
  const url = new URL("https://www.facebook.com/ads/library/");
  url.searchParams.set("active_status", "active");
  url.searchParams.set("ad_type", "all");
  url.searchParams.set("country", q.country);
  url.searchParams.set("q", q.q);
  url.searchParams.set("search_type", "keyword_unordered");
  url.searchParams.set("media_type", "all");

  const startRes = await fetch(
    `https://api.apify.com/v2/acts/${encodeURIComponent(APIFY_ACTOR)}/runs?token=${token}&memory=512`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startUrls: [{ url: url.toString() }],
        resultsLimit: 50,
        isDetailsPerAd: true,
        activeStatus: "active",
      }),
    },
  );
  if (!startRes.ok) {
    throw new Error(`apify run start failed: ${startRes.status}`);
  }
  const { data } = await startRes.json() as { data: { id: string; defaultDatasetId: string } };
  const runId = data.id;
  const datasetId = data.defaultDatasetId;

  // Poll until done (max ~3 min)
  const start = Date.now();
  while (Date.now() - start < 180_000) {
    await new Promise((r) => setTimeout(r, 5_000));
    const pollRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
    const meta = (await pollRes.json()).data as { status: string };
    if (["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"].includes(meta.status)) break;
  }

  const itemsRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&format=json&clean=1`,
  );
  const items = await itemsRes.json() as Array<Record<string, unknown>>;
  const pages = new Map<string, { name: string; url: string | null }>();
  for (const it of items) {
    if ("error" in it && Object.keys(it).length < 5) continue;
    const pid = (it.pageID ?? it.pageId ?? it.page_id ?? "").toString();
    if (!pid) continue;
    if (pages.has(pid)) continue;
    const name = (it.pageName ?? it.page_name ?? `Page ${pid}`) as string;
    let purl: string | null = null;
    const snap = it.snapshot as Record<string, unknown> | undefined;
    if (snap && typeof snap === "object") {
      purl = (snap.pageProfileUri ?? snap.page_profile_uri ?? null) as string | null;
    }
    pages.set(pid, { name: name.slice(0, 200), url: purl });
  }
  return pages;
}

/**
 * Run a full discovery cycle: one search per query, dedupe pageIds
 * across all results, insert new advertiser_pages rows.
 */
export async function runDiscoveryCycle(
  supabase: SupabaseClient,
  queries: DiscoveryQuery[],
  token: string,
): Promise<{ totalSearches: number; uniquePages: number; newPages: number; errors: number }> {
  console.log(`[discovery] starting cycle: ${queries.length} queries`);
  const concurrency = 6;
  const allPages = new Map<string, { name: string; url: string | null; state: string; postcode: string }>();
  let errors = 0;

  // batched concurrency
  for (let i = 0; i < queries.length; i += concurrency) {
    const batch = queries.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((q) => runDiscoverySearch(q, token).then((m) => ({ q, m }))),
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        const { q, m } = r.value;
        for (const [pid, info] of m) {
          if (!allPages.has(pid)) {
            allPages.set(pid, { ...info, state: q.state, postcode: q.postcode });
          }
        }
        console.log(`[discovery] q="${q.q}" found=${m.size}`);
      } else {
        errors++;
        console.error(`[discovery] query error: ${(r.reason as Error)?.message}`);
      }
    }
  }

  console.log(`[discovery] total unique pages: ${allPages.size}`);

  // Ensure anchor agency exists per state
  // @ts-expect-error supabase-js types
  const research = supabase.schema("research");
  const stateAgencies = new Map<string, string>();
  for (const state of new Set([...allPages.values()].map((p) => p.state))) {
    const name = `Discovered ${state}`;
    const normalized = name.toLowerCase();
    const { data, error } = await research
      .from("agencies")
      .upsert(
        {
          name,
          normalized_name: normalized,
          state,
          status: "market_seen_unverified",
          confidence: 30,
          metadata: { source: "apify-discovery", added: new Date().toISOString() },
        },
        { onConflict: "normalized_name,state" },
      )
      .select("id")
      .single();
    if (error) throw error;
    stateAgencies.set(state, data!.id);
    await research.from("agent_service_areas").upsert(
      {
        agency_id: data!.id,
        postcode: state === "WA" ? "6008" : "0000",
        suburb: `${state} Metro`,
        state,
        match_type: "manual",
        confidence: 30,
        evidence: { source: "apify-discovery" },
      },
      { onConflict: "agency_id,postcode,suburb,match_type", ignoreDuplicates: true },
    );
  }

  // Bulk-insert pages
  const rows = [...allPages.entries()].map(([pid, info]) => ({
    platform: "facebook",
    page_id: pid,
    page_name: info.name,
    page_url: info.url ?? `https://www.facebook.com/${pid}`,
    agency_id: stateAgencies.get(info.state)!,
    status: "resolved",
    confidence: 65,
    metadata: { source: "apify-discovery", added: new Date().toISOString(), postcode: info.postcode, state: info.state },
  }));

  let newPages = 0;
  if (rows.length > 0) {
    const { data, error } = await research
      .from("advertiser_pages")
      .upsert(rows, { onConflict: "platform,page_id", ignoreDuplicates: false })
      .select("id");
    if (error) throw error;
    newPages = data?.length ?? 0;
  }

  return {
    totalSearches: queries.length,
    uniquePages: allPages.size,
    newPages,
    errors,
  };
}
