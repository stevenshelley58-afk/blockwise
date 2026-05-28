import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { applyAbsence, applyObservation, summariseOutcomes } from "../../../src/lib/research/ingest.ts";
import { payloadHash } from "../../../src/lib/research/hash.ts";
import { normaliseApifyAd } from "../../../src/lib/research/normalise.ts";
import { SupabaseIngestWriter } from "../../../src/lib/research/supabase-writer.ts";
import { extractExternalAdId } from "../../../src/lib/research/schemas/index.ts";

import { ApifyClient } from "./apify-client.ts";
import type { OrchestratorEnv } from "./env.ts";
import type { DuePage } from "./policy.ts";

/**
 * Run one advertiser_page end-to-end:
 *   1. open ad_fetch_runs (status='running')
 *   2. call Apify
 *   3. persist raw payload to source_documents + Storage
 *   4. normalise + applyObservation per ad
 *   5. applyAbsence for ads previously seen on this page but not in this run
 *   6. close ad_fetch_runs (status='success'|'failed'|'partial')
 *   7. update advertiser_pages.last_checked_at + last_successful_check_at
 *
 * NEVER calls applyAbsence on a failed run. NEVER overwrites observed_ads
 * on a failed run.
 */
export async function refreshAdvertiserPage(args: {
  supabase: SupabaseClient;
  apify: ApifyClient;
  env: OrchestratorEnv;
  page: DuePage;
}): Promise<{
  fetchRunId: string;
  status: "success" | "failed" | "partial";
  observed: number;
  inserted: number;
  updated: number;
  unchanged: number;
  missing: number;
  costUsd: number;
}> {
  const { supabase, apify, env, page } = args;
  // @ts-expect-error supabase-js types
  const research = supabase.schema("research");

  const adFetchRunId = randomUUID();
  const inputPayload = {
    advertiser_page_id: page.advertiserPageId,
    page_id: page.pageId,
    platform: page.platform,
    resultsLimit: env.APIFY_RESULTS_LIMIT_PER_PAGE,
    activeStatus: "all" as const,
  };
  const inputHash = payloadHash(inputPayload);

  await research.from("ad_fetch_runs").insert({
    id: adFetchRunId,
    source_provider: "apify_scrapers",
    role: "primary",
    trigger: "scheduled",
    target_kind: "advertiser_page",
    target_value: page.advertiserPageId,
    input_payload: inputPayload,
    input_hash: inputHash,
    started_at: new Date().toISOString(),
    status: "running",
  });

  // Build the page URL from page_id if not present
  const pageUrl =
    page.pageUrl ||
    `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=AU&view_all_page_id=${encodeURIComponent(page.pageId)}`;

  let apifyOutcome;
  try {
    apifyOutcome = await apify.run({
      startUrls: [{ url: pageUrl }],
      resultsLimit: env.APIFY_RESULTS_LIMIT_PER_PAGE,
      activeStatus: "all",
      isDetailsPerAd: true,
    });
  } catch (err) {
    await research
      .from("ad_fetch_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error: (err as Error).message.slice(0, 1000),
      })
      .eq("id", adFetchRunId);
    // PROVIDER FAILURE NEVER OVERWRITES — bump consecutive_failed_checks on
    // the page, but do NOT mark any ads inactive and do NOT touch last_checked_at.
    await research
      .from("advertiser_pages")
      .update({ consecutive_failed_checks: 1 })
      .eq("id", page.advertiserPageId);
    return {
      fetchRunId: adFetchRunId,
      status: "failed",
      observed: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      missing: 0,
      costUsd: 0,
    };
  }

  if (apifyOutcome.status !== "SUCCEEDED") {
    await research
      .from("ad_fetch_runs")
      .update({
        status: "failed",
        completed_at: apifyOutcome.finishedAt ?? new Date().toISOString(),
        error: apifyOutcome.errorMessage,
        cost_usd: apifyOutcome.costUsd,
      })
      .eq("id", adFetchRunId);
    await research
      .from("advertiser_pages")
      .update({ consecutive_failed_checks: 1 })
      .eq("id", page.advertiserPageId);
    return {
      fetchRunId: adFetchRunId,
      status: "failed",
      observed: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      missing: 0,
      costUsd: apifyOutcome.costUsd,
    };
  }

  // Store raw payload in Storage + source_documents
  const sourceDocumentId = randomUUID();
  const rawJson = JSON.stringify(apifyOutcome.items);
  const storagePath = `apify/${page.advertiserPageId}/${apifyOutcome.runId}.json`;
  await supabase.storage.from(env.RESEARCH_RAW_EVIDENCE_BUCKET).upload(storagePath, rawJson, {
    contentType: "application/json",
    upsert: true,
  });
  await research.from("source_documents").insert({
    id: sourceDocumentId,
    source: "apify_scrapers",
    source_url: pageUrl,
    source_external_id: apifyOutcome.runId,
    fetched_at: apifyOutcome.finishedAt ?? new Date().toISOString(),
    storage_bucket: env.RESEARCH_RAW_EVIDENCE_BUCKET,
    storage_path: storagePath,
    content_hash: payloadHash(apifyOutcome.items),
    mime_type: "application/json",
    byte_size: rawJson.length,
    metadata: { itemCount: apifyOutcome.itemCount, datasetId: apifyOutcome.rawDatasetId },
  });

  if (env.ORCHESTRATOR_DRY_RUN) {
    await research
      .from("ad_fetch_runs")
      .update({
        status: "success",
        completed_at: new Date().toISOString(),
        cost_usd: apifyOutcome.costUsd,
        result_summary: { adsObserved: apifyOutcome.items.length, dryRun: true },
      })
      .eq("id", adFetchRunId);
    return {
      fetchRunId: adFetchRunId,
      status: "success",
      observed: apifyOutcome.items.length,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      missing: 0,
      costUsd: apifyOutcome.costUsd,
    };
  }

  const writer = new SupabaseIngestWriter(supabase);
  const now = new Date().toISOString();
  const seenExternalIds: string[] = [];
  const outcomes = [] as Awaited<ReturnType<typeof applyObservation>>[];
  const warnings: string[] = [];

  for (const ad of apifyOutcome.items) {
    let normalised;
    try {
      normalised = normaliseApifyAd({
        ad,
        advertiserPageId: page.advertiserPageId,
        observedByProvider: "apify_scrapers",
      });
    } catch (err) {
      warnings.push(`normalise: ${(err as Error).message}`);
      continue;
    }
    try {
      const outcome = await applyObservation(writer, {
        observation: normalised.observation,
        payloadHash: normalised.payloadHash,
        adFetchRunId,
        sourceProvider: "apify_scrapers",
        now,
      });
      outcomes.push(outcome);
      seenExternalIds.push(normalised.observation.externalAdId);

      // Best-effort creative upsert.
      await writer.upsertCreative({
        id: randomUUID(),
        observedAdId: outcome.observedAd.id,
        adSnapshotId: outcome.kind !== "unchanged" ? (outcome.snapshot?.id ?? null) : null,
        format: normalised.creative.format,
        headline: normalised.creative.headline,
        body: normalised.creative.body,
        cta: normalised.creative.cta,
        ctaUrl: normalised.creative.ctaUrl,
        primaryImageUrl: normalised.creative.primaryImageUrl,
        imageUrls: normalised.creative.imageUrls,
        videoUrl: normalised.creative.videoUrl,
        videoThumbnailUrl: normalised.creative.videoThumbnailUrl,
        landingUrl: normalised.creative.landingUrl,
        locale: normalised.creative.locale,
        language: normalised.creative.language,
        creativeHash: normalised.creative.creativeHash,
      });
    } catch (err) {
      warnings.push(`ingest ${extractExternalAdId(ad)}: ${(err as Error).message}`);
    }
  }

  const absence = await applyAbsence(writer, {
    advertiserPageId: page.advertiserPageId,
    seenExternalAdIds: seenExternalIds,
    adFetchRunId,
    sourceProvider: "apify_scrapers",
    now,
  });

  const summary = summariseOutcomes(outcomes, absence, {
    creditsSpent: apifyOutcome.costUsd,
    warnings,
    errorCount: warnings.length,
  });

  const status = warnings.length === 0 ? "success" : "partial";

  await research
    .from("ad_fetch_runs")
    .update({
      status,
      completed_at: new Date().toISOString(),
      cost_usd: apifyOutcome.costUsd,
      result_summary: summary,
      source_document_id: sourceDocumentId,
    })
    .eq("id", adFetchRunId);

  // Only on success: bump last_checked_at + last_successful_check_at, reset
  // consecutive_failed_checks.
  await research
    .from("advertiser_pages")
    .update({
      last_checked_at: now,
      last_successful_check_at: now,
      consecutive_failed_checks: 0,
    })
    .eq("id", page.advertiserPageId);

  return {
    fetchRunId: adFetchRunId,
    status,
    observed: summary.adsObserved,
    inserted: summary.adsNew,
    updated: summary.adsUpdated,
    unchanged: summary.adsUnchanged,
    missing: absence.incremented,
    costUsd: apifyOutcome.costUsd,
  };
}
