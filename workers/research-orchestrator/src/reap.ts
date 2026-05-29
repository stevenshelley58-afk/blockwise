/**
 * scripts/reap.ts
 *
 * Sandbox-only utility: take an existing successful Apify run and push
 * its dataset through the production ingestion pipeline. Used to
 * validate end-to-end when the bash sandbox can't keep a 60-second
 * Apify-polling process alive.
 *
 * The VPS-deployed orchestrator doesn't need this — its node process
 * lives forever and polls naturally. This is just a way to recover
 * from interrupted runs in dev.
 *
 * Usage:
 *   APIFY_RUN_ID=xxx FETCH_RUN_ID=yyy APIFY_DATASET_ID=zzz \
 *     ADVERTISER_PAGE_ID=aaa node --experimental-strip-types src/reap.ts
 */

import { createClient } from "@supabase/supabase-js";

import { applyAbsence, applyObservation, summariseOutcomes } from "../../../src/lib/research/ingest.ts";
import { payloadHash } from "../../../src/lib/research/hash.ts";
import { normaliseApifyAd } from "../../../src/lib/research/normalise.ts";
import { SupabaseIngestWriter } from "../../../src/lib/research/supabase-writer.ts";
import { apifyMetaAdsDatasetSchema } from "../../../src/lib/research/schemas/index.ts";
import { randomUUID } from "node:crypto";

const env = {
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  APIFY_API_TOKEN: process.env.APIFY_API_TOKEN!,
  APIFY_RUN_ID: process.env.APIFY_RUN_ID!,
  APIFY_DATASET_ID: process.env.APIFY_DATASET_ID!,
  FETCH_RUN_ID: process.env.FETCH_RUN_ID, // optional — if set, update this row instead of creating
  ADVERTISER_PAGE_ID: process.env.ADVERTISER_PAGE_ID!,
  RESEARCH_RAW_EVIDENCE_BUCKET: process.env.RESEARCH_RAW_EVIDENCE_BUCKET ?? "research-raw-evidence",
};

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // 1. Read the Apify run metadata
  const runMetaRes = await fetch(
    `https://api.apify.com/v2/actor-runs/${env.APIFY_RUN_ID}?token=${env.APIFY_API_TOKEN}`,
  );
  const runMeta = (await runMetaRes.json()).data;
  console.log(`apify run: status=${runMeta.status}, cost=$${runMeta.usageTotalUsd}, started=${runMeta.startedAt}`);
  if (runMeta.status !== "SUCCEEDED") {
    throw new Error(`refusing to reap a non-succeeded Apify run: ${runMeta.status}`);
  }

  // 2. Read the dataset
  const itemsRes = await fetch(
    `https://api.apify.com/v2/datasets/${env.APIFY_DATASET_ID}/items?token=${env.APIFY_API_TOKEN}&format=json&clean=1`,
  );
  const itemsRaw = await itemsRes.json();
  const items = apifyMetaAdsDatasetSchema.parse(itemsRaw);
  console.log(`dataset items: ${items.length}`);
  if (items.length === 0) {
    console.log("nothing to ingest");
    return;
  }

  // @ts-expect-error supabase-js types
  const research = supabase.schema("research");

  // 3. Find or create the fetch_run row
  let fetchRunId = env.FETCH_RUN_ID;
  if (!fetchRunId) {
    fetchRunId = randomUUID();
    await research.from("ad_fetch_runs").insert({
      id: fetchRunId,
      source_provider: "apify_scrapers",
      role: "primary",
      trigger: "manual",
      target_kind: "advertiser_page",
      target_value: env.ADVERTISER_PAGE_ID,
      input_payload: { apify_run_id: env.APIFY_RUN_ID, reaped: true },
      input_hash: payloadHash({ apify_run_id: env.APIFY_RUN_ID }),
      started_at: runMeta.startedAt,
      status: "running",
    });
  }

  // 4. Persist raw payload to storage + source_documents
  const sourceDocumentId = randomUUID();
  const rawJson = JSON.stringify(items);
  const storagePath = `apify/${env.ADVERTISER_PAGE_ID}/${env.APIFY_RUN_ID}.json`;
  const upload = await supabase.storage
    .from(env.RESEARCH_RAW_EVIDENCE_BUCKET)
    .upload(storagePath, rawJson, { contentType: "application/json", upsert: true });
  if (upload.error) console.error("storage upload error:", upload.error.message);
  await research.from("source_documents").insert({
    id: sourceDocumentId,
    source: "apify_scrapers",
    source_external_id: env.APIFY_RUN_ID,
    fetched_at: runMeta.finishedAt ?? new Date().toISOString(),
    storage_bucket: env.RESEARCH_RAW_EVIDENCE_BUCKET,
    storage_path: storagePath,
    content_hash: payloadHash(items),
    mime_type: "application/json",
    byte_size: rawJson.length,
    metadata: { itemCount: items.length, apifyRunId: env.APIFY_RUN_ID },
  });

  // 5. Run ingestion
  const writer = new SupabaseIngestWriter(supabase);
  const now = new Date().toISOString();
  const seen: string[] = [];
  const outcomes = [] as Awaited<ReturnType<typeof applyObservation>>[];

  for (const ad of items) {
    try {
      const n = normaliseApifyAd({
        ad,
        advertiserPageId: env.ADVERTISER_PAGE_ID,
        observedByProvider: "apify_scrapers",
      });
      const outcome = await applyObservation(writer, {
        observation: n.observation,
        payloadHash: n.payloadHash,
        adFetchRunId: fetchRunId,
        sourceProvider: "apify_scrapers",
        now,
      });
      outcomes.push(outcome);
      seen.push(n.observation.externalAdId);

      await writer.upsertCreative({
        id: randomUUID(),
        observedAdId: outcome.observedAd.id,
        adSnapshotId: outcome.kind !== "unchanged" ? (outcome.snapshot?.id ?? null) : null,
        format: n.creative.format,
        headline: n.creative.headline,
        body: n.creative.body,
        cta: n.creative.cta,
        ctaUrl: n.creative.ctaUrl,
        primaryImageUrl: n.creative.primaryImageUrl,
        imageUrls: n.creative.imageUrls,
        videoUrl: n.creative.videoUrl,
        videoThumbnailUrl: n.creative.videoThumbnailUrl,
        landingUrl: n.creative.landingUrl,
        locale: n.creative.locale,
        language: n.creative.language,
        creativeHash: n.creative.creativeHash,
      });

      // Tie to 6008/Subiaco since the seeded page is for that area.
      await writer.insertAreaMatches([{
        id: randomUUID(),
        observedAdId: outcome.observedAd.id,
        postcode: "6008",
        suburb: "Subiaco",
        state: "WA",
        matchType: "agency_service_area",
        confidence: 70,
        evidence: { source: "seeded_advertiser_page", apifyRunId: env.APIFY_RUN_ID },
      }]);
      console.log(`  ${outcome.kind}: ${n.observation.externalAdId} (${n.creative.format}) "${n.creative.headline?.slice(0,60) ?? ''}"`);
    } catch (err) {
      console.error(`  skip: ${(err as Error).message}`);
    }
  }

  const absence = await applyAbsence(writer, {
    advertiserPageId: env.ADVERTISER_PAGE_ID,
    seenExternalAdIds: seen,
    adFetchRunId: fetchRunId,
    sourceProvider: "apify_scrapers",
    now,
  });

  const summary = summariseOutcomes(outcomes, absence, {
    creditsSpent: runMeta.usageTotalUsd ?? 0,
  });

  await research
    .from("ad_fetch_runs")
    .update({
      status: "success",
      completed_at: new Date().toISOString(),
      cost_usd: runMeta.usageTotalUsd ?? 0,
      result_summary: summary,
      source_document_id: sourceDocumentId,
    })
    .eq("id", fetchRunId);

  await research
    .from("advertiser_pages")
    .update({
      last_checked_at: now,
      last_successful_check_at: now,
      consecutive_failed_checks: 0,
    })
    .eq("id", env.ADVERTISER_PAGE_ID);

  console.log("=== summary ===");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
