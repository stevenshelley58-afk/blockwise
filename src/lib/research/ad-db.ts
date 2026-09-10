export type AdDbMedia = {
  id: string; kind: string; storageBucket: string; objectKey: string;
  sha256: string; byteSize: number; mimeType: string; width: number | null; height: number | null;
};

export type AdDbRow = {
  id: string; library_id: string; advertiser_page_id: string; advertiser_page_meta_id: string | null;
  page_name: string; active_status: string; first_seen_at: string | null; last_seen_at: string | null;
  last_checked_at: string | null; ad_delivery_started_at: string | null; ad_delivery_stopped_at: string | null;
  ad_creation_date: string | null; ad_creative_id: string | null; format: string | null; headline: string | null;
  body: string | null; cta: string | null; ad_type: string | null; primary_intent: string | null;
  classification: Record<string, unknown>; display_state: string | null; ownership: Record<string, unknown>; locations: unknown; media: AdDbMedia[];
};

/** Only locally verified archive media crosses this contract. */
export function normaliseAdDbRow(row: AdDbRow, basePath = "/v1/ad-db"): Record<string, unknown> {
  const media = Array.isArray(row.media) ? row.media
    .filter((asset) => asset?.id && asset.storageBucket && asset.objectKey === `sha256/${asset.sha256}` && /^[a-f0-9]{64}$/u.test(asset.sha256) && asset.byteSize > 0 && asset.mimeType)
    .map((asset) => ({
      id: asset.id, kind: asset.kind, archiveUrl: `${basePath}/ads/${encodeURIComponent(row.id)}/media/${encodeURIComponent(asset.id)}`,
      sha256: asset.sha256, byteSize: asset.byteSize, mimeType: asset.mimeType, width: asset.width, height: asset.height,
    })) : [];
  return {
    id: row.id, libraryId: row.library_id,
    advertiserPage: { id: row.advertiser_page_id, metaPageId: row.advertiser_page_meta_id, name: row.page_name || "Unknown page" },
    attribution: row.ownership || {}, locations: Array.isArray(row.locations) ? row.locations : [],
    status: { active: row.active_status, display: row.display_state },
    dates: { firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at, lastCheckedAt: row.last_checked_at, startedAt: row.ad_delivery_started_at, stoppedAt: row.ad_delivery_stopped_at, createdAt: row.ad_creation_date },
    creative: { id: row.ad_creative_id, format: row.format, headline: row.headline, body: row.body, cta: row.cta, adType: row.ad_type, primaryIntent: row.primary_intent, classification: row.classification || {} },
    media,
  };
}
