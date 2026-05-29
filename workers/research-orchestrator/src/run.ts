import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { payloadHash } from "../../../src/lib/research/hash.ts";
import { applyAbsence, applyObservation, summariseOutcomes } from "../../../src/lib/research/ingest.ts";
import type { NormalisedCreative } from "../../../src/lib/research/normalise.ts";
import type { SourceProvider } from "../../../src/lib/research/schemas/index.ts";
import { SupabaseIngestWriter } from "../../../src/lib/research/supabase-writer.ts";

import type { AdCollectionProvider } from "./ad-provider.ts";
import type { OrchestratorEnv } from "./env.ts";
import type { DuePage } from "./policy.ts";

export async function refreshAdvertiserPage(args: {
  supabase: SupabaseClient;
  provider: AdCollectionProvider;
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
  const { supabase, provider, env, page } = args;
  const research = supabase.schema("research");

  const adFetchRunId = randomUUID();
  const pageUrl =
    page.pageUrl ||
    `https://www.facebook.com/ads/library/?active_status=${env.AD_COLLECTOR_ACTIVE_STATUS}&ad_type=all&country=${env.AD_COLLECTOR_COUNTRY}&view_all_page_id=${encodeURIComponent(page.pageId)}`;
  const inputPayload = {
    advertiser_page_id: page.advertiserPageId,
    page_id: page.pageId,
    platform: page.platform,
    provider: provider.name,
    resultsLimit: env.AD_COLLECTOR_RESULTS_LIMIT_PER_PAGE,
    activeStatus: env.AD_COLLECTOR_ACTIVE_STATUS,
    country: env.AD_COLLECTOR_COUNTRY,
  };

  await research.from("ad_fetch_runs").insert({
    id: adFetchRunId,
    source_provider: provider.sourceProvider,
    role: "primary",
    trigger: "scheduled",
    target_kind: "advertiser_page",
    target_value: page.advertiserPageId,
    input_payload: inputPayload,
    input_hash: payloadHash(inputPayload),
    started_at: new Date().toISOString(),
    status: "running",
  });

  let providerOutcome;
  try {
    providerOutcome = await provider.run({ page, pageUrl });
  } catch (err) {
    await markFetchFailed(research, {
      adFetchRunId,
      advertiserPageId: page.advertiserPageId,
      error: (err as Error).message,
      costUsd: 0,
    });
    return emptyRunResult(adFetchRunId, 0);
  }

  if (providerOutcome.status !== "SUCCEEDED") {
    await markFetchFailed(research, {
      adFetchRunId,
      advertiserPageId: page.advertiserPageId,
      completedAt: providerOutcome.finishedAt ?? undefined,
      error: providerOutcome.errorMessage ?? `provider status ${providerOutcome.status}`,
      costUsd: providerOutcome.costUsd,
    });
    return emptyRunResult(adFetchRunId, providerOutcome.costUsd);
  }

  const sourceDocumentId = randomUUID();
  const rawJson = JSON.stringify(providerOutcome.items);
  const storagePath = `${provider.sourceProvider}/${page.advertiserPageId}/${providerOutcome.runId}.json`;
  await supabase.storage.from(env.RESEARCH_RAW_EVIDENCE_BUCKET).upload(storagePath, rawJson, {
    contentType: "application/json",
    upsert: true,
  });
  await research.from("source_documents").insert({
    id: sourceDocumentId,
    source: provider.sourceProvider,
    source_url: pageUrl,
    source_external_id: providerOutcome.runId,
    fetched_at: providerOutcome.finishedAt ?? new Date().toISOString(),
    storage_bucket: env.RESEARCH_RAW_EVIDENCE_BUCKET,
    storage_path: storagePath,
    content_hash: payloadHash(providerOutcome.items),
    mime_type: "application/json",
    byte_size: rawJson.length,
    metadata: {
      itemCount: providerOutcome.itemCount,
      datasetId: providerOutcome.rawDatasetId,
      provider: provider.name,
      ...("metadata" in providerOutcome ? providerOutcome.metadata : {}),
    },
  });

  if (env.ORCHESTRATOR_DRY_RUN) {
    await research
      .from("ad_fetch_runs")
      .update({
        status: "success",
        completed_at: new Date().toISOString(),
        cost_usd: providerOutcome.costUsd,
        result_summary: { adsObserved: providerOutcome.items.length, dryRun: true },
        source_document_id: sourceDocumentId,
      })
      .eq("id", adFetchRunId);
    return {
      fetchRunId: adFetchRunId,
      status: "success",
      observed: providerOutcome.items.length,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      missing: 0,
      costUsd: providerOutcome.costUsd,
    };
  }

  const writer = new SupabaseIngestWriter(supabase);
  const now = new Date().toISOString();
  const seenExternalIds: string[] = [];
  const outcomes = [] as Awaited<ReturnType<typeof applyObservation>>[];
  const warnings: string[] = [];

  for (const ad of providerOutcome.items) {
    let normalised;
    try {
      normalised = provider.normalise(ad, { advertiserPageId: page.advertiserPageId });
    } catch (err) {
      warnings.push(`normalise: ${(err as Error).message}`);
      continue;
    }

    try {
      const outcome = await applyObservation(writer, {
        observation: normalised.observation,
        payloadHash: normalised.payloadHash,
        adFetchRunId,
        sourceProvider: provider.sourceProvider,
        now,
      });
      outcomes.push(outcome);
      seenExternalIds.push(normalised.observation.externalAdId);

      const mediaCapture = await captureCreativeMedia({
        supabase,
        env,
        sourceProvider: provider.sourceProvider,
        advertiserPageId: page.advertiserPageId,
        observedAdId: outcome.observedAd.id,
        externalAdId: normalised.observation.externalAdId,
        creative: normalised.creative,
      });
      warnings.push(...mediaCapture.warnings);

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
        imageStoragePath: mediaCapture.imageStoragePath,
        videoUrl: normalised.creative.videoUrl,
        videoStoragePath: mediaCapture.videoStoragePath,
        videoThumbnailUrl: normalised.creative.videoThumbnailUrl,
        mediaAssets: mediaCapture.mediaAssets,
        landingUrl: normalised.creative.landingUrl,
        locale: normalised.creative.locale,
        language: normalised.creative.language,
        creativeHash: normalised.creative.creativeHash,
      });

      await insertAreaMatches({ supabase, writer, page, observedAdId: outcome.observedAd.id, providerRunId: providerOutcome.runId });
    } catch (err) {
      warnings.push(`ingest ${safeExternalAdId(provider, ad)}: ${(err as Error).message}`);
    }
  }

  const absence = provider.confirmsAbsence
    ? await applyAbsence(writer, {
        advertiserPageId: page.advertiserPageId,
        seenExternalAdIds: seenExternalIds,
        adFetchRunId,
        sourceProvider: provider.sourceProvider,
        now,
      })
    : { incremented: 0, markedInactive: 0 };

  const summary = summariseOutcomes(outcomes, absence, {
    creditsSpent: providerOutcome.costUsd,
    warnings,
    errorCount: warnings.length,
  });
  const status = warnings.length === 0 ? "success" : "partial";

  await research
    .from("ad_fetch_runs")
    .update({
      status,
      completed_at: new Date().toISOString(),
      cost_usd: providerOutcome.costUsd,
      result_summary: summary,
      source_document_id: sourceDocumentId,
    })
    .eq("id", adFetchRunId);

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
    costUsd: providerOutcome.costUsd,
  };
}

async function markFetchFailed(
  research: ReturnType<SupabaseClient["schema"]>,
  args: {
    adFetchRunId: string;
    advertiserPageId: string;
    completedAt?: string;
    error: string;
    costUsd: number;
  },
): Promise<void> {
  await research
    .from("ad_fetch_runs")
    .update({
      status: "failed",
      completed_at: args.completedAt ?? new Date().toISOString(),
      error: args.error.slice(0, 1000),
      cost_usd: args.costUsd,
    })
    .eq("id", args.adFetchRunId);

  await research
    .from("advertiser_pages")
    .update({ consecutive_failed_checks: 1 })
    .eq("id", args.advertiserPageId);
}

function emptyRunResult(fetchRunId: string, costUsd: number) {
  return {
    fetchRunId,
    status: "failed" as const,
    observed: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    missing: 0,
    costUsd,
  };
}

async function insertAreaMatches(args: {
  supabase: SupabaseClient;
  writer: SupabaseIngestWriter;
  page: DuePage;
  observedAdId: string;
  providerRunId: string;
}): Promise<void> {
  const { supabase, writer, page, observedAdId, providerRunId } = args;
  const areaQ = await supabase
    .schema("research")
    .from("agent_service_areas")
    .select("postcode,suburb,state,confidence")
    .or(`agency_id.eq.${page.agencyIdForMatches ?? "00000000-0000-0000-0000-000000000000"},agent_id.eq.${page.agentIdForMatches ?? "00000000-0000-0000-0000-000000000000"}`)
    .limit(50);

  const areas = (areaQ.data ?? []) as Array<{ postcode: string; suburb: string; state: string; confidence: number }>;
  if (areas.length === 0 && page.postcode) {
    areas.push({ postcode: page.postcode, suburb: page.suburb ?? "Unknown", state: page.state, confidence: 50 });
  }
  if (areas.length === 0) return;

  await writer.insertAreaMatches(areas.map((area) => ({
    id: randomUUID(),
    observedAdId,
    postcode: area.postcode,
    suburb: area.suburb || page.suburb || "Unknown",
    state: area.state || page.state,
    matchType: "agency_service_area",
    confidence: Number(area.confidence) || 50,
    evidence: { source: "orchestrator_auto", providerRunId },
  })));
}

function safeExternalAdId(provider: AdCollectionProvider, ad: unknown): string {
  try {
    return provider.extractExternalAdId(ad as never);
  } catch {
    return "unknown";
  }
}

type MediaAssetKind = "image" | "video" | "thumbnail";

type StoredMediaAsset = {
  kind: MediaAssetKind;
  sourceUrl: string;
  storagePath: string;
  contentType: string | null;
  byteSize: number;
  capturedAt: string;
};

async function captureCreativeMedia(args: {
  supabase: SupabaseClient;
  env: OrchestratorEnv;
  sourceProvider: SourceProvider;
  advertiserPageId: string;
  observedAdId: string;
  externalAdId: string;
  creative: NormalisedCreative;
}): Promise<{
  imageStoragePath: string | null;
  videoStoragePath: string | null;
  mediaAssets: StoredMediaAsset[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const existing = await loadExistingCreativeMedia(args.supabase, args.observedAdId, warnings);
  const mediaAssets = [...existing.mediaAssets];
  const knownUrls = new Set(mediaAssets.map((asset) => asset.sourceUrl));
  const storedKinds = new Set(mediaAssets.map((asset) => asset.kind));
  if (existing.imageStoragePath) {
    storedKinds.add("image");
    storedKinds.add("thumbnail");
  }
  if (existing.videoStoragePath) storedKinds.add("video");

  const candidates = collectMediaCandidates(args.creative).filter(
    (candidate) => !knownUrls.has(candidate.sourceUrl) && !storedKinds.has(candidate.kind),
  );

  for (const candidate of candidates) {
    try {
      const asset = await downloadAndStoreMedia({
        supabase: args.supabase,
        bucket: args.env.RESEARCH_AD_CREATIVES_BUCKET,
        sourceProvider: args.sourceProvider,
        advertiserPageId: args.advertiserPageId,
        externalAdId: args.externalAdId,
        ...candidate,
      });
      mediaAssets.push(asset);
      knownUrls.add(candidate.sourceUrl);
      storedKinds.add(candidate.kind);
    } catch (err) {
      warnings.push(`media ${args.externalAdId}: ${(err as Error).message}`);
    }
  }

  return {
    imageStoragePath:
      existing.imageStoragePath ??
      mediaAssets.find((asset) => asset.kind === "image")?.storagePath ??
      mediaAssets.find((asset) => asset.kind === "thumbnail")?.storagePath ??
      null,
    videoStoragePath:
      existing.videoStoragePath ??
      mediaAssets.find((asset) => asset.kind === "video")?.storagePath ??
      null,
    mediaAssets,
    warnings,
  };
}

async function loadExistingCreativeMedia(
  supabase: SupabaseClient,
  observedAdId: string,
  warnings: string[],
): Promise<{ imageStoragePath: string | null; videoStoragePath: string | null; mediaAssets: StoredMediaAsset[] }> {
  const { data, error } = await supabase
    .schema("research")
    .from("ad_creatives")
    .select("image_storage_path,video_storage_path,media_assets")
    .eq("observed_ad_id", observedAdId)
    .maybeSingle();

  if (error) {
    warnings.push(`media lookup: ${error.message}`);
    return { imageStoragePath: null, videoStoragePath: null, mediaAssets: [] };
  }

  return {
    imageStoragePath: (data?.image_storage_path ?? null) as string | null,
    videoStoragePath: (data?.video_storage_path ?? null) as string | null,
    mediaAssets: parseStoredMediaAssets(data?.media_assets),
  };
}

function collectMediaCandidates(creative: NormalisedCreative): Array<{ kind: MediaAssetKind; sourceUrl: string }> {
  const out: Array<{ kind: MediaAssetKind; sourceUrl: string }> = [];
  const seen = new Set<string>();
  for (const sourceUrl of [creative.primaryImageUrl, ...creative.imageUrls]) {
    if (sourceUrl && !seen.has(sourceUrl)) {
      out.push({ kind: "image", sourceUrl });
      seen.add(sourceUrl);
    }
  }
  if (creative.videoUrl && !seen.has(creative.videoUrl)) {
    out.push({ kind: "video", sourceUrl: creative.videoUrl });
    seen.add(creative.videoUrl);
  }
  if (creative.videoThumbnailUrl && !seen.has(creative.videoThumbnailUrl)) {
    out.push({ kind: "thumbnail", sourceUrl: creative.videoThumbnailUrl });
  }
  return out;
}

async function downloadAndStoreMedia(args: {
  supabase: SupabaseClient;
  bucket: string;
  sourceProvider: SourceProvider;
  advertiserPageId: string;
  externalAdId: string;
  kind: MediaAssetKind;
  sourceUrl: string;
}): Promise<StoredMediaAsset> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(args.sourceUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BlockwiseResearchBot/1.0; +https://blockwise.sale)",
        "Accept": args.kind === "video" ? "video/*,*/*;q=0.8" : "image/*,*/*;q=0.8",
        "Referer": "https://www.facebook.com/ads/library/",
      },
    });
    if (!res.ok) {
      throw new Error(`download ${args.kind} failed ${res.status}`);
    }
    const contentType = normaliseContentType(res.headers.get("content-type"));
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) {
      throw new Error(`download ${args.kind} returned empty body`);
    }
    const storagePath = mediaStoragePath({
      sourceProvider: args.sourceProvider,
      advertiserPageId: args.advertiserPageId,
      externalAdId: args.externalAdId,
      kind: args.kind,
      sourceUrl: args.sourceUrl,
      contentType,
    });
    const { error } = await args.supabase.storage.from(args.bucket).upload(storagePath, bytes, {
      contentType: contentType ?? "application/octet-stream",
      upsert: true,
    });
    if (error) {
      throw new Error(`storage upload failed: ${error.message}`);
    }
    return {
      kind: args.kind,
      sourceUrl: args.sourceUrl,
      storagePath,
      contentType,
      byteSize: bytes.length,
      capturedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function mediaStoragePath(args: {
  sourceProvider: SourceProvider;
  advertiserPageId: string;
  externalAdId: string;
  kind: MediaAssetKind;
  sourceUrl: string;
  contentType: string | null;
}): string {
  const ext = extensionFromContentType(args.contentType) ?? extensionFromUrl(args.sourceUrl) ?? (args.kind === "video" ? "mp4" : "jpg");
  const urlHash = createHash("sha256").update(args.sourceUrl).digest("hex").slice(0, 16);
  return [
    args.sourceProvider,
    safePathSegment(args.advertiserPageId),
    safePathSegment(args.externalAdId),
    `${args.kind}-${urlHash}.${ext}`,
  ].join("/");
}

function parseStoredMediaAssets(value: unknown): StoredMediaAsset[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isStoredMediaAsset);
}

function isStoredMediaAsset(value: unknown): value is StoredMediaAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as Record<string, unknown>;
  return (
    (asset.kind === "image" || asset.kind === "video" || asset.kind === "thumbnail") &&
    typeof asset.sourceUrl === "string" &&
    typeof asset.storagePath === "string"
  );
}

function normaliseContentType(value: string | null): string | null {
  if (!value) return null;
  return value.split(";")[0]?.trim().toLowerCase() || null;
}

function extensionFromContentType(contentType: string | null): string | null {
  switch (contentType) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
    case "video/quicktime":
      return "mov";
    default:
      return null;
  }
}

function extensionFromUrl(sourceUrl: string): string | null {
  try {
    const pathname = new URL(sourceUrl).pathname;
    const match = pathname.match(/\.([a-z0-9]{2,5})$/iu);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 120);
}
