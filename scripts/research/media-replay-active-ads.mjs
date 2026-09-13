#!/usr/bin/env node
/**
 * media-replay-active-ads.mjs — archive every live ad's media from evidence the
 * database already holds.
 *
 * For each active observed ad whose creative has no verified archive object, read
 * the saved `raw_payload` and seed `research.media_assets` with every image, video
 * and thumbnail URL it contains, patch the creative's media columns, and enqueue a
 * media-collector job. No ad page is re-scanned and no capture credit is spent —
 * only media bytes are fetched.
 *
 * Usage:
 *   node scripts/research/media-replay-active-ads.mjs --dry-run [--limit=50]
 *   node scripts/research/media-replay-active-ads.mjs --apply   [--limit=50]
 *   ... --scope=all      include creatives on pages outside the first-fill lane
 *   ... --kinds=video    restrict to one or more of image,video,thumbnail
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

// Mirrors the runtime's collectStrings: media URLs live either as bare strings or
// inside objects under camelCase/snake_case keys, at any nesting depth.
function collectStrings(...values) {
  const out = new Set();
  for (const value of values) {
    if (typeof value === "string" && value.trim()) out.add(value.trim());
    else if (Array.isArray(value)) for (const nested of collectStrings(...value)) out.add(nested);
    else if (value && typeof value === "object") {
      for (const field of ["url", "uri", "src", "image_url", "original_image_url", "resized_image_url", "video_hd_url", "video_sd_url", "thumbnail_url", "video_preview_image_url", "imageUrl", "originalImageUrl", "resizedImageUrl", "videoHdUrl", "videoSdUrl", "thumbnailUrl", "videoPreviewImageUrl"]) {
        const v = value[field];
        if (typeof v === "string" && v.trim()) out.add(v.trim());
      }
    }
  }
  return [...out].filter((value) => /^https?:\/\//iu.test(value));
}

// A past `oe=` means the signed bytes are gone: report it, do not queue a doomed fetch.
function signedUrlExpiry(value) {
  const match = /[?&]oe=([0-9a-f]+)/iu.exec(String(value || ""));
  return match ? new Date(Number.parseInt(match[1], 16) * 1000) : null;
}
const live = (value) => { const expiry = signedUrlExpiry(value); return !expiry || expiry.getTime() > Date.now(); };

const limit = Number(args.limit || 50);
const dryRun = args["dry-run"] === true || args.apply !== true;
const scope = String(args.scope || "first_fill_lane");
const kinds = String(args.kinds || "image,video,thumbnail").split(",").map((kind) => kind.trim()).filter(Boolean);

const replayTag = "active-ads-replay-797cc3ed7";
const ads = await readAll("observed_ads?select=id,external_ad_id,advertiser_page_id,active_status,raw_payload&active_status=eq.active");
const creatives = await readAll("ad_creatives?select=id,observed_ad_id,format,image_urls,primary_image_url,video_url,video_thumbnail_url,ad_snapshot_id,metadata");
const assets = await readAll("media_assets?select=id,ad_creative_id,capture_status,archive_object_id");
const archivedByCreative = new Set(assets.filter((a) => a.archive_object_id).map((a) => a.ad_creative_id));
const creativesByAd = new Map();
for (const creative of creatives) {
  if (!creativesByAd.has(creative.observed_ad_id)) creativesByAd.set(creative.observed_ad_id, []);
  creativesByAd.get(creative.observed_ad_id).push(creative);
}
const pageIds = [...new Set(ads.map((row) => row.advertiser_page_id).filter(Boolean))];
const pages = [];
for (let index = 0; index < pageIds.length; index += 200) {
  const chunk = pageIds.slice(index, index + 200).map((id) => `"${id}"`).join(",");
  pages.push(...await rest(`advertiser_pages?select=id,page_name,scan_enabled,agent:agents(state,status),agency:agencies(state,status)&id=in.(${chunk})`));
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
let expiredOnly = 0;
let skippedNoCreative = 0;
for (const ad of ads) {
  const list = creativesByAd.get(ad.id) || [];
  if (!list.length) { skippedNoCreative += 1; continue; }
  const page = pageById.get(ad.advertiser_page_id);
  if (scope === "first_fill_lane" && !inFirstFillLane(page)) { skippedOutOfLane += 1; continue; }
  const snapshot = ad.raw_payload?.snapshot ?? ad.raw_payload ?? {};
  for (const creative of list) {
    if (archivedByCreative.has(creative.id)) continue;
    const sources = [];
    if (kinds.includes("image")) {
      for (const sourceUrl of collectStrings(snapshot.images, cardMediaValues(snapshot.cards, "image"))) sources.push({ kind: "image", sourceUrl });
    }
    if (kinds.includes("video")) {
      for (const sourceUrl of collectStrings(snapshot.videos, cardMediaValues(snapshot.cards, "video"))) sources.push({ kind: "video", sourceUrl });
    }
    if (kinds.includes("thumbnail")) {
      for (const sourceUrl of collectStrings(snapshot.thumbnails, snapshot.videos, cardMediaValues(snapshot.cards, "thumbnail"))) sources.push({ kind: "thumbnail", sourceUrl });
    }
    const unique = [...new Map(sources.map((source) => [`${source.kind}|${source.sourceUrl}`, source])).values()];
    const stillValid = unique.filter((source) => live(source.sourceUrl));
    if (!unique.length) { skippedNoMedia += 1; continue; }
    if (!stillValid.length) expiredOnly += 1;
    plan.push({
      creativeId: creative.id,
      observedAdId: ad.id,
      advertiserPageId: ad.advertiser_page_id,
      pageName: page?.page_name ?? null,
      adId: ad.external_ad_id,
      format: creative.format,
      sources: stillValid,
      expiredCount: unique.length - stillValid.length,
    });
    break; // one creative per ad is enough to trigger the collector; the rest follow at ingest
  }
  if (plan.length >= limit) break;
}

const summary = {
  mode: dryRun ? "dry-run" : "apply",
  scope,
  kinds: kinds.join(","),
  activeAds: ads.length,
  plannedCreatives: plan.length,
  skippedOutOfLane,
  skippedNoMedia,
  skippedNoCreative,
  creativesWithExpiredOnly: expiredOnly,
  mediaUrlsPlanned: plan.reduce((total, item) => total + item.sources.length, 0),
  mediaUrlsExpired: plan.reduce((total, item) => total + item.expiredCount, 0),
  byKind: plan.reduce((acc, item) => { for (const source of item.sources) acc[source.kind] = (acc[source.kind] || 0) + 1; return acc; }, {}),
};
console.log(JSON.stringify(summary, null, 1));
console.log(JSON.stringify(plan.filter((item) => item.sources.length).slice(0, 3).map((item) => ({ adId: item.adId, page: item.pageName, format: item.format, sources: item.sources.length })), null, 1));

if (dryRun) process.exit(0);

let patched = 0;
let assetsQueued = 0;
let jobsQueued = 0;
for (const item of plan) {
  const images = item.sources.filter((source) => source.kind === "image").map((source) => source.sourceUrl);
  const videos = item.sources.filter((source) => source.kind === "video").map((source) => source.sourceUrl);
  const thumbs = item.sources.filter((source) => source.kind === "thumbnail").map((source) => source.sourceUrl);
  const patch = { metadata: { media_source: "saved_payload_active_ads_replay", media_source_at: new Date().toISOString(), replay: replayTag } };
  if (images.length) { patch.image_urls = images; patch.primary_image_url = images[0]; }
  if (videos.length) patch.video_url = videos[0];
  if (thumbs.length) patch.video_thumbnail_url = thumbs[0];
  await rest(`ad_creatives?id=eq.${item.creativeId}`, { method: "PATCH", body: JSON.stringify(patch) });
  patched += 1;

  for (const [index, source] of item.sources.entries()) {
    const existing = await rest(`media_assets?select=id,archive_object_id&ad_creative_id=eq.${item.creativeId}&source_url=eq.${encodeURIComponent(source.sourceUrl)}&limit=1`);
    if (existing?.[0]?.id) {
      if (!existing[0].archive_object_id) {
        await rest(`media_assets?id=eq.${existing[0].id}`, { method: "PATCH", body: JSON.stringify({ capture_status: "pending", archive_failure_reason: null }) });
      }
      assetsQueued += 1;
      continue;
    }
    await rest("media_assets", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        ad_creative_id: item.creativeId,
        observed_ad_id: item.observedAdId,
        kind: source.kind,
        source_url: source.sourceUrl,
        capture_status: "pending",
        metadata: { source_provider: "meta_ad_library", external_asset_id: `${source.kind}:${index}:active-ads-replay`, replay: replayTag },
      }),
    });
    assetsQueued += 1;
  }

  const dedupeKey = `ad-radar:media:${item.creativeId}:${replayTag}`;
  const pending = await rest(`work_queue?select=id&dedupe_key=eq.${encodeURIComponent(dedupeKey)}&status=in.(pending,claimed)&limit=1`);
  if (pending?.length) continue;
  const created = await rest("work_queue", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      queue_name: "research",
      job_type: "blockwise-media-collector",
      dedupe_key: dedupeKey,
      advertiser_page_id: item.advertiserPageId,
      priority: 5,
      payload: { adCreativeId: item.creativeId, observedAdId: item.observedAdId, ad_db_child: true, parent_scan_mode: "initial_fill", replay: replayTag },
      status: "pending",
      max_attempts: 3,
    }),
  });
  if (created?.[0]?.id) jobsQueued += 1;
}
console.log(JSON.stringify({ patched, assetsQueued, jobsQueued }, null, 1));
