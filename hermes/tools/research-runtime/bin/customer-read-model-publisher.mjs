import { randomUUID } from "node:crypto";

import {
  hermesSupabaseHeaders,
  resolveHermesCustomerSupabaseCredential,
} from "./supabase-credentials.mjs";

const CARD_VIEW = "v_customer_meta_ad_library_cards";
const HISTORY_VIEW = "v_customer_agent_ad_history";
const PAGE_SIZE = 500;
const WRITE_BATCH_SIZE = 100;

function cleanUrl(value) {
  return String(value ?? "").replace(/\/+$/u, "");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function buildCustomerRest(env, fetchImpl) {
  const url = cleanUrl(env.HERMES_CUSTOMER_SUPABASE_URL);
  const credential = resolveHermesCustomerSupabaseCredential(env);
  if (!url || !credential) return null;

  return async function customerRest(path, init = {}) {
    const response = await fetchImpl(`${url}/rest/v1/${path}`, {
      ...init,
      headers: hermesSupabaseHeaders(credential, {
        "Content-Type": "application/json",
        ...(init.headers || {}),
      }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${init.method || "GET"} customer read model ${path} failed ${response.status}: ${text.slice(0, 700)}`);
    }
    return text ? JSON.parse(text) : null;
  };
}

async function readAll(researchRest, relation, select = "*") {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await researchRest(
      "research",
      `${relation}?select=${encodeURIComponent(select)}&limit=${PAGE_SIZE}&offset=${offset}`,
    );
    rows.push(...(page || []));
    if (!page || page.length < PAGE_SIZE) return rows;
  }
}

async function readVersions(researchRest, observedAdIds) {
  const versions = [];
  for (let index = 0; index < observedAdIds.length; index += 80) {
    const ids = observedAdIds.slice(index, index + 80).join(",");
    const rows = await researchRest(
      "research",
      `ad_creative_versions?select=id,ad_creative_id,observed_ad_id,version,creative_hash,format,headline,body,cta,ad_type,primary_intent,display_state,created_at&observed_ad_id=in.(${ids})&order=observed_ad_id.asc,version.desc`,
    );
    versions.push(...(rows || []));
  }
  return versions;
}

function mergeCards(cards, historyRows, creativeRows, revision, publishedAt) {
  const historyByAd = new Map(historyRows.map((row) => [row.observed_ad_id, row]));
  const creativeByAd = new Map();
  for (const row of creativeRows) {
    if (row.observed_ad_id && row.id && !creativeByAd.has(row.observed_ad_id)) {
      creativeByAd.set(row.observed_ad_id, row.id);
    }
  }
  const mergedByAd = new Map();

  for (const card of cards) {
    if (!card.card_id || mergedByAd.has(card.card_id)) continue;
    const history = historyByAd.get(card.card_id) || {};
    mergedByAd.set(card.card_id, {
      ...card,
      observed_ad_id: card.card_id,
      source_ad_creative_id: creativeByAd.get(card.card_id) || null,
      external_ad_id: history.external_ad_id ?? card.library_id ?? null,
      advertiser_page_id: history.advertiser_page_id ?? null,
      platform: history.platform ?? null,
      first_seen_at: history.first_seen_at ?? null,
      ad_creation_date: history.ad_creation_date ?? null,
      last_checked_at: history.last_checked_at ?? null,
      classification: asObject(history.classification),
      snapshot_count: Number(history.snapshot_count || 0),
      primary_image_url: card.primary_image_url ?? history.primary_image_url ?? null,
      video_url: card.video_url ?? history.video_url ?? null,
      image_urls: asArray(card.image_urls).length > 0
        ? asArray(card.image_urls)
        : asArray(history.image_urls),
      image_storage_path: card.image_storage_path ?? history.image_storage_path ?? null,
      video_storage_path: card.video_storage_path ?? history.video_storage_path ?? null,
      video_thumbnail_url: card.video_thumbnail_url ?? history.video_thumbnail_url ?? null,
      media_assets: card.media_assets && typeof card.media_assets === "object"
        ? card.media_assets
        : asArray(history.media_assets),
      primary_intent: history.primary_intent ?? null,
      display_state: history.display_state ?? null,
      publisher_platforms: asArray(card.publisher_platforms),
      postcodes: asArray(card.postcodes),
      ad_area_postcodes: asArray(card.ad_area_postcodes),
      ad_area_suburbs: asArray(card.ad_area_suburbs),
      service_area_postcodes: asArray(card.service_area_postcodes),
      service_area_suburbs: asArray(card.service_area_suburbs),
      attribution_links: asArray(card.attribution_links),
      hooks: Array.isArray(card.hooks) ? card.hooks : [],
      source_revision: revision,
      source_updated_at: card.last_seen_at ?? history.last_checked_at ?? null,
      published_at: publishedAt,
    });
  }
  return [...mergedByAd.values()];
}

function mapVersions(versions, visibleIds, revision, publishedAt) {
  return versions.flatMap((row) => {
    if (!row.id || !row.observed_ad_id || !row.ad_creative_id || !visibleIds.has(row.observed_ad_id)) return [];
    return [{
      id: row.id,
      observed_ad_id: row.observed_ad_id,
      source_ad_creative_id: row.ad_creative_id,
      version: row.version,
      creative_hash: row.creative_hash,
      format: row.format,
      headline: row.headline,
      body: row.body,
      cta: row.cta,
      ad_type: row.ad_type,
      primary_intent: row.primary_intent,
      display_state: row.display_state,
      created_at: row.created_at,
      source_revision: revision,
      published_at: publishedAt,
    }];
  });
}

async function writeBatches(customerRest, relation, rows, conflictColumn) {
  for (let index = 0; index < rows.length; index += WRITE_BATCH_SIZE) {
    await customerRest(`${relation}?on_conflict=${conflictColumn}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(rows.slice(index, index + WRITE_BATCH_SIZE)),
    });
  }
}

export async function publishCustomerReadModels({
  researchRest,
  env = process.env,
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
}) {
  const customerRest = buildCustomerRest(env, fetchImpl);
  if (!customerRest) return { skipped: true, reason: "customer_supabase_not_configured" };

  const revision = randomUUID();
  const startedAt = now();
  await customerRest("customer_ad_radar_publications", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      source_revision: revision,
      source_card_count: 0,
      source_version_count: 0,
      started_at: startedAt,
      status: "running",
    }),
  });

  try {
    const [cardRows, historyRows, creativeRows] = await Promise.all([
      readAll(researchRest, CARD_VIEW),
      readAll(researchRest, HISTORY_VIEW),
      readAll(researchRest, "ad_creatives", "id,observed_ad_id,updated_at"),
    ]);
    creativeRows.sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")));
    const publishedAt = now();
    const cards = mergeCards(cardRows, historyRows, creativeRows, revision, publishedAt);
    const visibleIds = new Set(cards.map((row) => row.observed_ad_id));
    const versions = mapVersions(
      await readVersions(researchRest, [...visibleIds]),
      visibleIds,
      revision,
      publishedAt,
    );

    await writeBatches(customerRest, "customer_ad_radar_cards", cards, "card_id");
    await writeBatches(customerRest, "customer_ad_radar_creative_versions", versions, "id");

    await customerRest(`customer_ad_radar_creative_versions?source_revision=neq.${revision}`, { method: "DELETE" });
    await customerRest(`customer_ad_radar_cards?source_revision=neq.${revision}`, { method: "DELETE" });
    await customerRest(`customer_ad_radar_publications?source_revision=eq.${revision}`, {
      method: "PATCH",
      body: JSON.stringify({
        source_card_count: cards.length,
        source_version_count: versions.length,
        completed_at: now(),
        status: "complete",
        error: null,
      }),
    });
    return { skipped: false, revision, cards: cards.length, versions: versions.length };
  } catch (error) {
    await customerRest(`customer_ad_radar_publications?source_revision=eq.${revision}`, {
      method: "PATCH",
      body: JSON.stringify({
        completed_at: now(),
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000),
      }),
    }).catch(() => {});
    throw error;
  }
}
