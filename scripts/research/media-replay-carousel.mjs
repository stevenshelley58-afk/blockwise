#!/usr/bin/env node
/**
 * media-replay-carousel.mjs — archive carousel media that the pre-918b8e94f
 * extractor dropped, using only evidence already saved in the database.
 *
 * For each active carousel creative whose image_urls are empty but whose
 * observed_ads.raw_payload carries card media:
 *   1. re-derive the media sources with the shipped extractor,
 *   2. patch ad_creatives.image_urls / metadata.media_sources_from_payload,
 *   3. upsert research.media_assets rows (capture_status=pending),
 *   4. enqueue blockwise-media-collector jobs so the worker archives the bytes.
 *
 * No ad page is re-scanned and no capture credits are spent: only media bytes.
 *
 * Usage:
 *   node scripts/research/media-replay-carousel.mjs --dry-run [--limit=40]
 *   node scripts/research/media-replay-carousel.mjs --apply  [--limit=40]
 *   ... --scope=all            include creatives on pages outside the first-fill lane
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { cardMediaValues } = await import(resolve(here, "../../hermes/tools/research-runtime/bin/ad-radar-media.mjs"));

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--([a-z-]+)(?:=(.*))?$/iu.exec(arg);
  return match ? [match[1], match[2] === undefined ? true : match[2]] : [arg, true];
}));

function envFile(path) {
  const values = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/gu, "");
  }
  return values;
}
const fileEnv = envFile("/srv/hermes/secrets/ad-db-worker.env");
const url = process.env.HERMES_SUPABASE_URL || fileEnv.HERMES_SUPABASE_URL;
const key = process.env.HERMES_SUPABASE_SECRET_KEY || fileEnv.HERMES_SUPABASE_SECRET_KEY || fileEnv.HERMES_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("missing Supabase credentials"); process.exit(2); }
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "research", "Content-Type": "application/json" };

async function rest(path, init = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method || "GET"} ${path} -> ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
async function readAll(path, pageSize = 500) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const batch = await rest(`${path}&limit=${pageSize}&offset=${offset}`);
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
}

const limit = Number(args.limit || 40);
const dryRun = args["dry-run"] === true || args.apply !== true;
const scope = String(args.scope || "first_fill_lane");

// Media URLs are signed; a past `oe=` means the bytes are gone and only a fresh
// capture could recover them, so label those instead of queueing a doomed fetch.
function signedUrlExpiry(value) {
  const match = /[?&]oe=([0-9a-f]+)/iu.exec(String(value || ""));
  return match ? new Date(Number.parseInt(match[1], 16) * 1000) : null;
}

const creatives = await readAll(
  "ad_creatives?select=id,observed_ad_id,format,image_urls,primary_image_url,video_url,video_thumbnail_url,ad_snapshot_id,classification_status,metadata&format=eq.carousel&image_urls=eq.{}&order=updated_at.desc",
).then((rows) => rows.filter((row) => row.metadata?.media_source !== "saved_payload_card_replay"));
const activeAds = await readAll("observed_ads?select=id,external_ad_id,advertiser_page_id,active_status,raw_payload&active_status=eq.active");
const activeById = new Map(activeAds.map((row) => [row.id, row]));
const pageIds = [...new Set(activeAds.map((row) => row.advertiser_page_id).filter(Boolean))];
const pages = [];
for (let index = 0; index < pageIds.length; index += 200) {
  const chunk = pageIds.slice(index, index + 200).map((id) => `"${id}"`).join(",");
  pages.push(...await rest(`advertiser_pages?select=id,page_name,scan_enabled,initial_fill_completed_at,agent:agents(state,status),agency:agencies(state,status)&id=in.(${chunk})`));
}
const pageById = new Map(pages.map((row) => [row.id, row]));
const inFirstFillLane = (page) => {
  if (!page?.scan_enabled) return false;
  const owner = (record) => record && String(record.state || "").toUpperCase() === "WA" && String(record.status || "") === "licensed_verified";
  return owner(page.agent) || owner(page.agency);
};

const plan = [];
let skippedOutOfLane = 0;
let skippedNoMedia = 0;
let expired = 0;
for (const creative of creatives) {
  const ad = activeById.get(creative.observed_ad_id);
  if (!ad) continue;
  const page = pageById.get(ad.advertiser_page_id);
  if (scope === "first_fill_lane" && !inFirstFillLane(page)) { skippedOutOfLane += 1; continue; }
  const snapshot = ad.raw_payload?.snapshot ?? ad.raw_payload ?? {};
  const imageUrls = cardMediaValues(snapshot.cards, "image");
  if (!imageUrls.length) { skippedNoMedia += 1; continue; }
  const stillValid = imageUrls.filter((value) => {
    const expiry = signedUrlExpiry(value);
    return !expiry || expiry.getTime() > Date.now();
  });
  if (!stillValid.length) expired += 1;
  plan.push({
    creativeId: creative.id,
    observedAdId: creative.observed_ad_id,
    advertiserPageId: ad.advertiser_page_id,
    pageName: page?.page_name ?? null,
    adId: ad.external_ad_id,
    urls: imageUrls,
    stillValid,
    expiredCount: imageUrls.length - stillValid.length,
  });
  if (plan.length >= limit) break;
}

const summary = {
  mode: dryRun ? "dry-run" : "apply",
  scope,
  activeCarouselCreatives: creatives.length,
  planned: plan.length,
  skippedOutOfLane,
  skippedNoMedia,
  creativesWithExpiredOnly: expired,
  mediaUrlsPlanned: plan.reduce((total, item) => total + item.stillValid.length, 0),
  mediaUrlsExpired: plan.reduce((total, item) => total + item.expiredCount, 0),
};
console.log(JSON.stringify(summary, null, 1));
console.log(JSON.stringify(plan.slice(0, 3).map((item) => ({ adId: item.adId, page: item.pageName, urls: item.stillValid.length, expired: item.expiredCount })), null, 1));

if (dryRun) process.exit(0);

let patched = 0;
let assets = 0;
let queued = 0;
for (const item of plan) {
  await rest(`ad_creatives?id=eq.${item.creativeId}`, {
    method: "PATCH",
    body: JSON.stringify({
      image_urls: item.stillValid,
      primary_image_url: item.stillValid[0] ?? null,
      metadata: { media_source: "saved_payload_card_replay", media_source_at: new Date().toISOString(), recovered_from_run: "918b8e94f" },
    }),
  });
  patched += 1;
  for (const [index, sourceUrl] of item.stillValid.entries()) {
    const existingAssets = await rest(`media_assets?select=id,capture_status,archive_object_id&ad_creative_id=eq.${item.creativeId}&source_url=eq.${encodeURIComponent(sourceUrl)}&limit=1`);
    if (existingAssets?.[0]?.id) {
      if (!existingAssets[0].archive_object_id) {
        await rest(`media_assets?id=eq.${existingAssets[0].id}`, { method: "PATCH", body: JSON.stringify({ capture_status: "pending", last_error: null }) });
      }
      assets += 1;
      continue;
    }
    await rest("media_assets", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        ad_creative_id: item.creativeId,
        observed_ad_id: item.observedAdId,
        kind: "image",
        source_url: sourceUrl,
        capture_status: "pending",
        metadata: { source_provider: "meta_ad_library", external_asset_id: `image:${index}:card-replay`, replay: "918b8e94f" },
      }),
    });
    assets += 1;
  }
  const dedupeKey = `ad-radar:media:${item.creativeId}:card-replay-918b8e94f`;
  const existing = await rest(`work_queue?select=id&dedupe_key=eq.${encodeURIComponent(dedupeKey)}&status=in.(pending,claimed)&limit=1`);
  if (existing?.length) continue;
  const created = await rest("work_queue", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      queue_name: "research",
      job_type: "blockwise-media-collector",
      dedupe_key: dedupeKey,
      advertiser_page_id: item.advertiserPageId,
      priority: 5,
      payload: { adCreativeId: item.creativeId, observedAdId: item.observedAdId, ad_db_child: true, parent_scan_mode: "initial_fill", replay: "carousel-card-media" },
      status: "pending",
      max_attempts: 3,
    }),
  });
  if (created?.[0]?.id) queued += 1;
}
console.log(JSON.stringify({ patched, assetsQueued: assets, jobsQueued: queued }, null, 1));
