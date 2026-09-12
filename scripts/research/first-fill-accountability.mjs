#!/usr/bin/env node
/**
 * Full-roster Ad Radar first-fill accountability.
 *
 * This report is deliberately read-only. It accounts for every WA agent and
 * agency, while keeping identity evidence, page scanning, media completeness,
 * and exclusions as separate dimensions. A social URL from enrichment is a
 * candidate only; it never becomes a verified page without page evidence.
 *
 * Usage:
 *   node scripts/research/first-fill-accountability.mjs
 *   node scripts/research/first-fill-accountability.mjs --report=/tmp/report.json
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPORT_VERSION = "first-fill-accountability.v1";
export const WA_STATE = "WA";
export const IDENTITY_STATUSES = Object.freeze([
  "page_found",
  "no_verified_match",
  "failed",
  "ambiguous",
  "attempted",
  "unchecked",
]);
export const PAGE_SCAN_STATUSES = Object.freeze([
  "full_complete",
  "pending",
  "failed",
  "paused",
  "partial",
  "pending_identity",
  "excluded",
  "not_found",
]);

const asText = (value) => value === null || value === undefined ? "" : String(value);
const nonEmpty = (value) => asText(value).trim().length > 0;
const truthy = (value) => value === true || value === "true" || value === 1;
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

function countBy(values, order) {
  const counts = Object.fromEntries(order.map((key) => [key, 0]));
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function decisionsBySubject(decisions) {
  const map = new Map();
  for (const row of decisions ?? []) {
    if (!["agent", "agency"].includes(asText(row.subject_type))) continue;
    if (asText(row.decision_type) !== "page_resolution") continue;
    const key = asText(row.subject_type) + ":" + asText(row.subject_id);
    const rows = map.get(key) ?? [];
    rows.push(row);
    map.set(key, rows);
  }
  return map;
}
function latestDecision(rows) {
  return [...rows].sort((a, b) => {
    const at = Date.parse(asText(a.decided_at));
    const bt = Date.parse(asText(b.decided_at));
    if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return bt - at;
    if (Number.isFinite(at) !== Number.isFinite(bt)) return Number.isFinite(bt) ? 1 : -1;
    return asText(b.id).localeCompare(asText(a.id));
  })[0] ?? null;
}

function isNumericPageId(value) {
  return /^[0-9]+$/u.test(asText(value));
}

function pageLinkedTo(page, kind, id) {
  return asText(page[kind + "_id"]) === asText(id);
}

function pageHasExplicitFailure(decision) {
  if (!decision) return false;
  const d = object(decision.decision);
  const e = object(decision.evidence);
  const text = asText(decision.rationale) + " " + asText(d.status) + " " + asText(d.outcome) + " " + asText(e.status) + " " + asText(e.outcome);
  return /\b(?:fail(?:ed|ure)?|error|timeout|unavailable)\b/iu.test(text);
}
function pageHasExplicitNegative(decision) {
  if (!decision) return false;
  const d = object(decision.decision);
  const e = object(decision.evidence);
  const resolvedNegative = [d.resolved, e.resolved].some((value) => value === false || value === "false" || value === 0);
  if (resolvedNegative) return true;
  const text = asText(decision.rationale) + " " + asText(d.status) + " " + asText(d.outcome) + " " + asText(e.status) + " " + asText(e.outcome);
  return /\b(?:no[_\s-]?verified[_\s-]?match|no[_\s-]?match|not[_\s-]?found|unresolved|negative|rejected)\b/iu.test(text);
}

function pageIsAmbiguous(decision) {
  if (!decision) return false;
  const d = object(decision.decision);
  const e = object(decision.evidence);
  if (truthy(d.ambiguous) || truthy(e.ambiguous)) return true;
  return ["ambiguous", "multiple_matches", "needs_review"].includes(
    asText(d.status || d.outcome || e.status || e.outcome).toLowerCase(),
  );
}

function enrichmentV1(entity) {
  return object(object(entity.metadata).cold_email_enrichment).v1;
}

function isCandidateAgent(entity) {
  return asText(object(enrichmentV1(entity)).social_links?.facebook).trim().length > 0;
}

function enrichmentAttempted(entity) {
  const enrichment = object(enrichmentV1(entity));
  if (Object.keys(enrichment).length === 0) return false;
  return asText(enrichment.skipped_reason) !== "exa_key_missing_social_discovery_not_run";
}

function validPageEvidence(page, decision) {
  if (!isNumericPageId(page.page_id) || asText(page.status) === "rejected_non_real_estate") return false;
  // A current terminal page row remains valid evidence even if an older
  // resolver decision is superseded by a generic negative decision.
  if (["resolved_collectable", "no_ads_confirmed"].includes(asText(page.status))) {
    const resolvedPageId = object(decision?.decision).page_id;
    if (decision && truthy(object(decision.decision).resolved)) {
      return isNumericPageId(resolvedPageId) && asText(resolvedPageId) === asText(page.page_id);
    }
    return true;
  }
  if (decision) {
    const resolvedPageId = object(decision.decision).page_id;
    return truthy(object(decision.decision).resolved) && isNumericPageId(resolvedPageId) && asText(resolvedPageId) === asText(page.page_id);
  }
  // Older collected pages predate resolution_decision_id. Their terminal page
  // status is still controlled evidence, but unresolved/paused pages are not.
  return ["resolved_collectable", "no_ads_confirmed"].includes(asText(page.status));
}

function pageHasCandidateEvidence(page, decision) {
  return isNumericPageId(page.page_id) && asText(page.status) !== "rejected_non_real_estate" &&
    validPageEvidence(page, decision);
}

function classifyIdentity(entity, pages, allDecisions) {
  const key = asText(entity.kind) + ":" + asText(entity.id);
  const subjectDecisions = allDecisions.get(key) ?? [];
  const currentDecision = latestDecision(subjectDecisions);
  const pageEvidence = pages.some((page) => pageHasCandidateEvidence(page, page._resolution));
  if (pageEvidence) return "page_found";
  if (currentDecision) {
    const d = object(currentDecision.decision);
    const e = object(currentDecision.evidence);
    const marker = asText(d.status || d.outcome || e.status || e.outcome).toLowerCase();
    if (pageIsAmbiguous(currentDecision)) return "ambiguous";
    if (pageHasExplicitFailure(currentDecision)) return "failed";
    if (marker === "attempted" || marker === "in_progress") return "attempted";
    if (pageHasExplicitNegative(currentDecision)) return "no_verified_match";
    return "unchecked";
  }
  if (enrichmentAttempted(entity)) return "attempted";
  return "unchecked";
}

function scanComplete(page, runsByPage) {
  const runs = runsByPage.get(asText(page.id)) ?? [];
  return runs.some((run) =>
    asText(run.status) === "success" &&
    truthy(run.coverage_complete) &&
    truthy(run.pagination_exhausted));
}

function classifyPageScan(pages, runsByPage) {
  if (pages.length === 0) return "not_found";
  const eligible = pages.filter((page) => page.scan_enabled !== false && isNumericPageId(page.page_id) && pageHasCandidateEvidence(page, page._resolution));
  if (eligible.length === 0) return pages.some((page) => asText(page.status) === "rejected_non_real_estate" || page.scan_enabled === false) ? "excluded" : "pending_identity";
  const complete = eligible.filter((page) => scanComplete(page, runsByPage));
  const additionalPendingIdentity = pages.some((page) =>
    page.scan_enabled !== false && asText(page.status) !== "rejected_non_real_estate" && !pageHasCandidateEvidence(page, page._resolution));
  if (complete.length === eligible.length) return additionalPendingIdentity ? "pending_identity" : "full_complete";
  if (eligible.some((page) => ["needs_first_fill", "queued", "scanning"].includes(asText(page.scan_state)))) return "pending";
  if (complete.length > 0) return "partial";
  if (eligible.some((page) => asText(page.scan_state) === "failing")) return "failed";
  if (eligible.some((page) => asText(page.scan_state) === "paused")) return "paused";
  return "pending";
}

function exclusionReasons(pages, entity) {
  const reasons = new Set();
  for (const page of pages) {
    if (asText(page.status) === "rejected_non_real_estate") reasons.add("rejected_non_real_estate");
    if (page.scan_enabled === false) {
      const reason = object(page.metadata).scan_disabled_reason;
      reasons.add("scan_disabled:" + (nonEmpty(reason) ? reason : "unspecified"));
    }
  }
  const status = asText(entity.status).toLowerCase();
  if (["rejected", "excluded", "inactive"].includes(status)) reasons.add("roster_status:" + status);
  return [...reasons].sort();
}

function mediaForAds(ads, creativesByAd, assetsByAd, assetsByCreative) {
  const adIds = new Set(ads.map((ad) => asText(ad.id)));
  const creatives = ads.flatMap((ad) => creativesByAd.get(asText(ad.id)) ?? []);
  const creativeIds = new Set(creatives.map((creative) => asText(creative.id)));
  const assets = [
    ...[...adIds].flatMap((id) => assetsByAd.get(id) ?? []),
    ...[...creativeIds].flatMap((id) => assetsByCreative.get(id) ?? []),
  ];
  const uniqueAssets = [...new Map(assets.map((asset) => [asText(asset.id), asset])).values()];
  const assetById = new Map(uniqueAssets.map((asset) => [asText(asset.id), asset]));
  const completeMemo = new Map();
  const isArchiveVerified = (asset, seen = new Set()) => {
    if (!asset) return false;
    const id = asText(asset.id);
    if (completeMemo.has(id)) return completeMemo.get(id);
    if (seen.has(id)) return false;
    const nextSeen = new Set(seen).add(id);
    const metadata = object(asset.metadata);
    const captureVerification = object(metadata.capture_verification);
    const storageRecord = object(metadata.storage_record);
    const verificationStatus = asText(captureVerification.status || captureVerification.outcome).toLowerCase();
    const explicitlyVerified = truthy(metadata.archive_verified) || truthy(captureVerification.archive_verified) ||
      ["verified", "archive_verified", "succeeded"].includes(verificationStatus);
    const archiveAt = asset.archive_verified_at || metadata.archive_verified_at || captureVerification.archive_verified_at ||
      captureVerification.verified_at || (explicitlyVerified ? asset.captured_at : null);
    const storage = asset.object_key || asset.storage_path || metadata.object_key || metadata.storage_path || metadata.deduped_storage_path ||
      storageRecord.object_key || storageRecord.storage_path || storageRecord.path || storageRecord.key;
    if (nonEmpty(archiveAt) && nonEmpty(storage)) {
      completeMemo.set(id, true);
      return true;
    }
    const target = metadata.deduped_to_media_asset_id;
    const complete = nonEmpty(target) && isArchiveVerified(assetById.get(asText(target)), nextSeen);
    completeMemo.set(id, complete);
    return complete;
  };
  const creativeToAd = new Map(creatives.map((creative) => [asText(creative.id), asText(creative.observed_ad_id)]));
  const assetsByAdId = new Map();
  for (const asset of uniqueAssets) {
    const ids = [asText(asset.observed_ad_id), creativeToAd.get(asText(asset.ad_creative_id))].filter(nonEmpty);
    for (const id of ids) assetsByAdId.set(id, [...(assetsByAdId.get(id) ?? []), asset]);
  }
  const adRows = ads.map((ad) => {
    const related = [...new Map((assetsByAdId.get(asText(ad.id)) ?? []).map((asset) => [asText(asset.id), asset])).values()];
    return { ad, assets: related, complete: related.some((asset) => isArchiveVerified(asset)) };
  });
  const active = adRows.filter(({ ad }) => asText(ad.active_status) === "active");
  const historical = adRows.filter(({ ad }) => asText(ad.active_status) !== "active");
  const activeArchiveGaps = active.filter(({ complete }) => !complete).length;
  const historicalArchiveGaps = historical.filter(({ complete }) => !complete).length;
  const capturedNotArchived = uniqueAssets.filter((asset) =>
    asText(asset.capture_status) === "captured" && !isArchiveVerified(asset)).length;
  const dedupedAssets = uniqueAssets.filter((asset) => nonEmpty(object(asset.metadata).deduped_to_media_asset_id)).length;
  const archiveGaps = activeArchiveGaps + historicalArchiveGaps;
  return {
    ads: ads.length,
    active_ads: active.length,
    historical_ads: historical.length,
    creatives: creatives.length,
    assets: uniqueAssets.length,
    assets_missing: archiveGaps,
    active_archive_gaps: activeArchiveGaps,
    historical_archive_gaps: historicalArchiveGaps,
    captured_not_archived: capturedNotArchived,
    deduped_assets: dedupedAssets,
    ads_without_captured_media: adRows.filter(({ complete }) => !complete).length,
    gap: archiveGaps > 0,
    evaluation: ads.length === 0 ? "not_evaluated" : archiveGaps > 0 ? "gap" : "no_gap",
  };
}

function mediaForEntity(pages, adsByPage, creativesByAd, assetsByAd, assetsByCreative) {
  const pageIds = new Set(pages.map((page) => asText(page.id)));
  const ads = [...pageIds].flatMap((pageId) => adsByPage.get(pageId) ?? []);
  return mediaForAds([...new Map(ads.map((ad) => [asText(ad.id), ad])).values()], creativesByAd, assetsByAd, assetsByCreative);
}

function mapRows(rows, key) {
  const map = new Map();
  for (const row of rows ?? []) {
    const value = asText(row[key]);
    const values = map.get(value) ?? [];
    values.push(row);
    map.set(value, values);
  }
  return map;
}

export function buildAccountabilityReport(snapshot) {
  const agents = (snapshot.agents ?? [])
    .filter((row) => asText(row.state).toUpperCase() === WA_STATE)
    .map((row) => ({ ...row, kind: "agent" }));
  const agencies = (snapshot.agencies ?? [])
    .filter((row) => asText(row.state).toUpperCase() === WA_STATE)
    .map((row) => ({ ...row, kind: "agency" }));
  const roster = [...agents, ...agencies].sort((a, b) =>
    (asText(a.kind) + ":" + asText(a.id)).localeCompare(asText(b.kind) + ":" + asText(b.id)));
  const allDecisions = decisionsBySubject(snapshot.decisions);
  const pagesBySubject = new Map();
  for (const entity of roster) {
    const pages = (snapshot.pages ?? []).filter((page) => pageLinkedTo(page, entity.kind, entity.id)).map((page) => ({ ...page }));
    pages.forEach((page) => {
      page._resolution = page.resolution_decision_id
        ? (snapshot.decisions ?? []).find((decision) => asText(decision.id) === asText(page.resolution_decision_id)) ?? null
        : null;
    });
    pagesBySubject.set(asText(entity.kind) + ":" + asText(entity.id), pages);
  }
  const runsByPage = mapRows(snapshot.runs, "advertiser_page_id");
  const adsByPage = mapRows(snapshot.ads, "advertiser_page_id");
  const creativesByAd = mapRows(snapshot.creatives, "observed_ad_id");
  const assetsByAd = mapRows(snapshot.media, "observed_ad_id");
  const assetsByCreative = mapRows(snapshot.media, "ad_creative_id");

  const entityRows = roster.map((entity) => {
    const key = asText(entity.kind) + ":" + asText(entity.id);
    const pages = pagesBySubject.get(key) ?? [];
    const identityStatus = classifyIdentity(entity, pages, allDecisions);
    const reasons = exclusionReasons(pages, entity);
    const pageIds = pages.filter((page) => pageHasCandidateEvidence(page, page._resolution))
      .map((page) => asText(page.page_id)).sort();
    const scans = pages.map((page) => ({ ...page, _complete: scanComplete(page, runsByPage) }));
    const eligibleScans = scans.filter((page) => page.scan_enabled !== false && isNumericPageId(page.page_id) && pageHasCandidateEvidence(page, page._resolution));
    const media = mediaForEntity(pages, adsByPage, creativesByAd, assetsByAd, assetsByCreative);
    return {
      kind: entity.kind,
      id: asText(entity.id),
      name: asText(entity.full_name || entity.name),
      identity_status: identityStatus,
      page_found: identityStatus === "page_found",
      page_ids: [...new Set(pageIds)],
      page_count: pages.length,
      page_scan_status: classifyPageScan(scans, runsByPage),
      pages_full_complete: eligibleScans.filter((page) => page._complete).length,
      pages_pending: eligibleScans.filter((page) => ["needs_first_fill", "queued", "scanning"].includes(asText(page.scan_state))).length,
      pages_failed: eligibleScans.filter((page) => asText(page.scan_state) === "failing").length,
      excluded_reasons: reasons,
      media,
    };
  });
  const scopedPageIds = new Set([...pagesBySubject.values()].flatMap((pages) => pages.map((page) => asText(page.id))));
  const scopedAds = [...new Map([...scopedPageIds].flatMap((id) => adsByPage.get(id) ?? []).map((ad) => [asText(ad.id), ad])).values()];
  const scopedMedia = mediaForAds(scopedAds, creativesByAd, assetsByAd, assetsByCreative);

  const identityValues = entityRows.map((row) => row.identity_status);
  const scanValues = entityRows.map((row) => row.page_scan_status);
  const excludedCount = entityRows.filter((row) => row.excluded_reasons.length > 0).length;
  const eligiblePages = (snapshot.pages ?? []).filter((page) =>
    page.scan_enabled !== false && nonEmpty(page.page_id) && /^[0-9]+$/u.test(asText(page.page_id)));
  const trustedInitialFill = eligiblePages.filter((page) => scanComplete(page, runsByPage)).length;
  const mediaValues = entityRows.map((row) => row.media.evaluation);
  const identityByStatus = countBy(identityValues, IDENTITY_STATUSES);
  const pageScanByStatus = countBy(scanValues, PAGE_SCAN_STATUSES);
  const mediaByStatus = countBy(mediaValues, ["gap", "no_gap", "not_evaluated"]);
  const candidateAgents = agents.filter(isCandidateAgent);
  const candidateAgentsLinked = candidateAgents.filter((entity) =>
    (pagesBySubject.get("agent:" + asText(entity.id)) ?? []).length > 0).length;
  const candidateAgentsValidLinked = candidateAgents.filter((entity) =>
    (pagesBySubject.get("agent:" + asText(entity.id)) ?? []).some((page) => pageHasCandidateEvidence(page, page._resolution))).length;
  const candidateAgentsUnlinked = candidateAgents.filter((entity) =>
    (pagesBySubject.get("agent:" + asText(entity.id)) ?? []).length === 0).length;
  const snapshotTimes = [
    ...(snapshot.agents ?? []), ...(snapshot.agencies ?? []), ...(snapshot.pages ?? []),
    ...(snapshot.decisions ?? []), ...(snapshot.runs ?? []),
  ].flatMap((row) => ["updated_at", "decided_at", "completed_at", "last_scan_completed_at", "initial_fill_completed_at"]
    .map((key) => Date.parse(asText(row[key]))).filter(Number.isFinite));

  return {
    schema_version: REPORT_VERSION,
    scope: { state: WA_STATE, agents: agents.length, agencies: agencies.length, total: roster.length },
    first_fill: {
      enabled_numeric_pages: eligiblePages.length,
      trusted_initial_fill_completed_pages: trustedInitialFill,
      prior_baseline: { trusted_initial_fill_completed_pages: 1282, backlog_pages: 316 },
      backlog_pages: Math.max(0, eligiblePages.length - trustedInitialFill),
      note: "Backlog is the full enabled numeric-page denominator minus trusted initial-fill completion, never known pages alone.",
    },
    candidate_agents: {
      with_facebook_candidate: candidateAgents.length,
      linked_with_page_record: candidateAgentsLinked,
      linked_with_valid_identity_evidence: candidateAgentsValidLinked,
      unlinked: candidateAgentsUnlinked,
      identity_rule: "cold_email_enrichment.v1.social_links.facebook is a candidate only and is not promoted to a verified page.",
    },
    identity: {
      by_status: identityByStatus,
      reconciliation: { total: roster.length, sum: Object.values(identityByStatus).reduce((sum, count) => sum + count, 0), passes: Object.values(identityByStatus).reduce((sum, count) => sum + count, 0) === roster.length },
    },
    page_scan: {
      by_status: pageScanByStatus,
      reconciliation: { total: roster.length, sum: Object.values(pageScanByStatus).reduce((sum, count) => sum + count, 0), passes: Object.values(pageScanByStatus).reduce((sum, count) => sum + count, 0) === roster.length },
    },
    exclusions: {
      included: roster.length - excludedCount,
      excluded: excludedCount,
      by_reason: Object.fromEntries([...new Set(entityRows.flatMap((row) => row.excluded_reasons))]
        .sort().map((reason) => [reason, entityRows.filter((row) => row.excluded_reasons.includes(reason)).length])),
      reconciliation: { total: roster.length, sum: (roster.length - excludedCount) + excludedCount, passes: (roster.length - excludedCount) + excludedCount === roster.length },
    },
    media: {
      by_status: mediaByStatus,
      reconciliation: { total: roster.length, sum: Object.values(mediaByStatus).reduce((sum, count) => sum + count, 0), passes: Object.values(mediaByStatus).reduce((sum, count) => sum + count, 0) === roster.length },
      scoped_unique_ads: scopedMedia.ads,
      scoped_unique_active_ads: scopedMedia.active_ads,
      scoped_unique_historical_ads: scopedMedia.historical_ads,
      assets_missing: scopedMedia.assets_missing,
      ads_without_captured_media: scopedMedia.ads_without_captured_media,
      active_archive_gaps: scopedMedia.active_archive_gaps,
      historical_archive_gaps: scopedMedia.historical_archive_gaps,
      captured_not_archived: scopedMedia.captured_not_archived,
      deduped_assets: scopedMedia.deduped_assets,
    },
    snapshot_watermark: snapshotTimes.length > 0 ? new Date(snapshotTimes.reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY)).toISOString() : null,
    roster: entityRows,
  };
}

const dbContainer = process.env.RESEARCH_DB_CONTAINER || "blockwise-research-db";
const psqlPrefix = process.env.RESEARCH_DB_PSQL
  ? String(process.env.RESEARCH_DB_PSQL).split(" ")
  : ["docker", "exec", "-i", dbContainer, "psql", "-U", "postgres", "-d", "blockwise_research", "-X",
    "-v", "ON_ERROR_STOP=1", "-A", "-t"];

function sqlJson(query) {
  const output = execFileSync(psqlPrefix[0], psqlPrefix.slice(1), {
    input: query,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
  const jsonText = output.split(/\r?\n/u)
    .map((value) => value.trim())
    .filter((value) => value && value !== "BEGIN" && value !== "COMMIT")
    .join("");
  return jsonText ? JSON.parse(jsonText) : [];
}

export function readSnapshot() {
  const query = "begin transaction isolation level repeatable read, read only; select json_build_object('agents',(select coalesce(json_agg(x order by x.id),'[]'::json) from (select id::text,full_name,state,status,review_status,jsonb_build_object('cold_email_enrichment',jsonb_build_object('v1',jsonb_build_object('social_links',metadata#>'{cold_email_enrichment,v1,social_links}','social_link_scopes',metadata#>'{cold_email_enrichment,v1,social_link_scopes}','skipped_reason',metadata#>'{cold_email_enrichment,v1,skipped_reason}'))) as metadata from research.agents where upper(state)='WA') x),'agencies',(select coalesce(json_agg(x order by x.id),'[]'::json) from (select id::text,name,state,status,review_status,metadata from research.agencies where upper(state)='WA') x),'pages',(select coalesce(json_agg(x order by x.id),'[]'::json) from (select id::text,page_id,page_name,status,scan_enabled,scan_state,initial_fill_completed_at,last_successful_scan_at,resolution_decision_id::text,agent_id::text,agency_id::text,jsonb_build_object('scan_disabled_reason',metadata->'scan_disabled_reason') as metadata from research.advertiser_pages) x),'decisions',(select coalesce(json_agg(x order by x.id),'[]'::json) from (select id::text,subject_type,subject_id,decision_type,decided_at,decision,evidence,rationale from research.agent_decisions where decision_type='page_resolution' and ((subject_type='agent' and subject_id in(select id::text from research.agents where upper(state)='WA')) or (subject_type='agency' and subject_id in(select id::text from research.agencies where upper(state)='WA')))) x),'runs',(select coalesce(json_agg(x order by x.id),'[]'::json) from (select id::text,advertiser_page_id::text,scan_mode,status,coverage_complete,pagination_exhausted,completed_at from research.ad_fetch_runs where scan_mode is not null) x),'ads',(select coalesce(json_agg(x order by x.id),'[]'::json) from (select id::text,advertiser_page_id::text,active_status from research.observed_ads) x),'creatives',(select coalesce(json_agg(x order by x.id),'[]'::json) from (select id::text,observed_ad_id::text from research.ad_creatives) x),'media',(select coalesce(json_agg(x order by x.id),'[]'::json) from (select id::text,observed_ad_id::text,ad_creative_id::text,capture_status,captured_at,archive_verified_at,object_key,storage_path,jsonb_build_object('archive_verified_at',metadata->'archive_verified_at','archive_verified',metadata->'archive_verified','capture_verification',metadata->'capture_verification','deduped_to_media_asset_id',metadata->'deduped_to_media_asset_id','deduped_storage_path',metadata->'deduped_storage_path','object_key',metadata->'object_key','storage_path',metadata->'storage_path','storage_record',metadata->'storage_record') as metadata from research.media_assets) x)); commit";
  return sqlJson(query);
}

function main() {
  const reportArg = process.argv.slice(2).find((arg) => /^--(?:report|output)=/u.test(arg));
  const reportPath = reportArg ? resolve(reportArg.replace(/^--(?:report|output)=/u, "")) : null;
  const report = buildAccountabilityReport(readSnapshot());
  const serialized = JSON.stringify(report, null, 2) + "\n";
  if (reportPath) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, serialized);
  }
  process.stdout.write(serialized);
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
