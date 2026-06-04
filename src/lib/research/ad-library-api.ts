export const RESEARCH_AD_SELECT = [
  "agency_id",
  "agency_name",
  "agent_id",
  "agent_name",
  "advertiser_page_id",
  "page_name",
  "platform",
  "observed_ad_id",
  "external_ad_id",
  "active_status",
  "first_seen_at",
  "last_seen_at",
  "last_checked_at",
  "headline",
  "body",
  "cta",
  "primary_image_url",
  "video_url",
  "format",
  "classification",
  "snapshot_count",
  "ad_delivery_started_at",
  "ad_delivery_stopped_at",
  "ad_creation_date",
  "image_urls",
  "image_storage_path",
  "video_storage_path",
  "video_thumbnail_url",
  "media_assets",
  "ad_type",
  "primary_intent",
  "display_state",
].join(",");

export type ResearchAdListRow = {
  agency_id: string | null;
  agency_name: string | null;
  agent_id: string | null;
  agent_name: string | null;
  advertiser_page_id: string;
  page_name: string | null;
  platform: string | null;
  observed_ad_id: string;
  external_ad_id: string | null;
  active_status: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  last_checked_at: string | null;
  headline: string | null;
  body: string | null;
  cta: string | null;
  primary_image_url: string | null;
  video_url: string | null;
  format: string | null;
  classification: Record<string, unknown> | null;
  snapshot_count: number | null;
  ad_delivery_started_at: string | null;
  ad_delivery_stopped_at: string | null;
  ad_creation_date: string | null;
  image_urls: unknown;
  image_storage_path: string | null;
  video_storage_path: string | null;
  video_thumbnail_url: string | null;
  media_assets: unknown;
  ad_type: string | null;
  primary_intent: string | null;
  display_state: string | null;
};

export type ResearchAdApiRecord = {
  id: string;
  libraryId: string | null;
  page: {
    id: string;
    name: string;
  };
  agent: {
    id: string | null;
    name: string | null;
  };
  agency: {
    id: string | null;
    name: string | null;
  };
  status: {
    active: string;
    display: string | null;
  };
  dates: {
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    lastCheckedAt: string | null;
    startedAt: string | null;
    stoppedAt: string | null;
    createdAt: string | null;
  };
  platforms: string[];
  creative: {
    format: string | null;
    headline: string | null;
    body: string | null;
    cta: string | null;
    adType: string | null;
    primaryIntent: string | null;
    hooks: string[];
  };
  media: Array<{
    kind: string;
    url: string;
    storagePath: string | null;
    sourceUrl: string | null;
  }>;
  source: {
    snapshotUrl: string | null;
    snapshotCount: number;
  };
};

export function normaliseResearchAd(row: ResearchAdListRow): ResearchAdApiRecord {
  const libraryId = cleanString(row.external_ad_id);
  return {
    id: row.observed_ad_id,
    libraryId,
    page: {
      id: row.advertiser_page_id,
      name: cleanString(row.page_name) ?? "Unknown page",
    },
    agent: {
      id: row.agent_id,
      name: cleanString(row.agent_name),
    },
    agency: {
      id: row.agency_id,
      name: cleanString(row.agency_name),
    },
    status: {
      active: cleanString(row.active_status) ?? "unknown",
      display: cleanString(row.display_state),
    },
    dates: {
      firstSeenAt: cleanString(row.first_seen_at),
      lastSeenAt: cleanString(row.last_seen_at),
      lastCheckedAt: cleanString(row.last_checked_at),
      startedAt: cleanString(row.ad_delivery_started_at),
      stoppedAt: cleanString(row.ad_delivery_stopped_at),
      createdAt: cleanString(row.ad_creation_date),
    },
    platforms: uniqueStrings([row.platform]),
    creative: {
      format: cleanString(row.format),
      headline: cleanString(row.headline),
      body: cleanString(row.body),
      cta: cleanString(row.cta),
      adType: cleanString(row.ad_type) ?? cleanString(row.classification?.ad_type) ?? cleanString(row.classification?.type),
      primaryIntent:
        cleanString(row.primary_intent) ??
        cleanString(row.classification?.primary_intent) ??
        cleanString(row.classification?.intent),
      hooks: Array.isArray(row.classification?.hooks)
        ? row.classification.hooks.filter((hook): hook is string => typeof hook === "string")
        : [],
    },
    media: normaliseMedia(row),
    source: {
      snapshotUrl: libraryId ? `https://www.facebook.com/ads/library/?id=${encodeURIComponent(libraryId)}` : null,
      snapshotCount: row.snapshot_count ?? 0,
    },
  };
}

export function researchAdsToCsv(records: ResearchAdApiRecord[]): string {
  const headers = [
    "id",
    "library_id",
    "page_name",
    "agency_name",
    "agent_name",
    "active_status",
    "ad_type",
    "primary_intent",
    "headline",
    "body",
    "cta",
    "last_seen_at",
    "source_url",
  ];
  const rows = records.map((record) => [
    record.id,
    record.libraryId ?? "",
    record.page.name,
    record.agency.name ?? "",
    record.agent.name ?? "",
    record.status.active,
    record.creative.adType ?? "",
    record.creative.primaryIntent ?? "",
    record.creative.headline ?? "",
    record.creative.body ?? "",
    record.creative.cta ?? "",
    record.dates.lastSeenAt ?? "",
    record.source.snapshotUrl ?? "",
  ]);

  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

function normaliseMedia(row: ResearchAdListRow): ResearchAdApiRecord["media"] {
  const media: ResearchAdApiRecord["media"] = [];
  addMedia(media, "image", row.image_storage_path, null);
  addMedia(media, "video", row.video_storage_path, row.video_url);
  addMedia(media, "thumbnail", row.video_thumbnail_url, null);
  addMedia(media, "image", row.primary_image_url, row.primary_image_url);

  if (Array.isArray(row.image_urls)) {
    for (const url of row.image_urls) {
      addMedia(media, "image", null, cleanString(url));
    }
  }

  if (Array.isArray(row.media_assets)) {
    for (const asset of row.media_assets) {
      if (!asset || typeof asset !== "object") continue;
      const item = asset as Record<string, unknown>;
      addMedia(
        media,
        cleanString(item.kind) ?? cleanString(item.type) ?? "unknown",
        cleanString(item.storagePath) ?? cleanString(item.storage_path),
        cleanString(item.sourceUrl) ?? cleanString(item.source_url) ?? cleanString(item.url),
      );
    }
  }

  return media;
}

function addMedia(
  media: ResearchAdApiRecord["media"],
  kind: string,
  storagePath: string | null,
  sourceUrl: string | null,
) {
  const url = storagePath ?? sourceUrl;
  if (!url || media.some((item) => item.url === url)) return;
  media.push({ kind, url, storagePath, sourceUrl });
}

function cleanString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map(cleanString).filter((value): value is string => Boolean(value)))];
}

function csvCell(value: string): string {
  if (!/[",\n\r]/u.test(value)) return value;
  return `"${value.replace(/"/g, "\"\"")}"`;
}
