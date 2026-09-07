import type {
  CustomerMetaAdLibraryCard,
  CustomerMetaAdLibraryMedia,
} from "./customer-meta-card.ts";
import { cleanCustomerMetaDisplayText } from "./customer-meta-card.ts";
import type { AdDbMedia, AdDbRow } from "./ad-db.ts";

type OwnershipSubject = {
  id?: unknown;
  name?: unknown;
  relationship?: unknown;
};
type Location = {
  id?: unknown;
  suburb?: unknown;
  state?: unknown;
  postcode?: unknown;
  relation?: unknown;
};

export function mapAdDbRowToCustomerMetaCard(
  row: AdDbRow,
): CustomerMetaAdLibraryCard {
  const agent = ownershipSubject(row.ownership, "agent");
  const agency = ownershipSubject(row.ownership, "agency");
  const locations = normaliseLocations(row.locations);
  const adLocations = locations
    .filter((location) =>
      ["property", "copy_mention", "meta_targeting"].includes(
        location.relation,
      ),
    )
    .sort(compareLocationEvidence);
  const serviceLocations = locations
    .filter((location) =>
      ["office", "service_area"].includes(location.relation),
    )
    .sort((a, b) => (a.id ?? "").localeCompare(b.id ?? ""));
  const primary = adLocations[0] ?? null;

  return {
    id: row.id,
    libraryId: clean(row.library_id),
    agentId: clean(agent?.id),
    agentName: cleanCustomerMetaDisplayText(agent?.name),
    agencyId: clean(agency?.id),
    agencyName: cleanCustomerMetaDisplayText(agency?.name),
    attributionLinks: [
      attribution("agent", agent),
      attribution("agency", agency),
    ].filter(isRecord),
    pageId: clean(row.advertiser_page_meta_id),
    pageName: cleanCustomerMetaDisplayText(row.page_name) ?? "Unknown page",
    pageUrl: null,
    pageImageUrl: null,
    activeStatus: activeStatus(row.active_status),
    startedAt: clean(row.ad_delivery_started_at),
    stoppedAt:
      row.active_status === "active" ? null : clean(row.ad_delivery_stopped_at),
    lastSeenAt: clean(row.last_seen_at),
    platforms: [],
    postcode: primary?.postcode ?? null,
    suburb: primary?.suburb ?? null,
    state: primary?.state ?? null,
    postcodes: unique(adLocations.map((location) => location.postcode)),
    areaMatchPostcode: primary?.postcode ?? null,
    areaMatchSuburb: primary?.suburb ?? null,
    areaMatchState: primary?.state ?? null,
    areaMatchType: primary?.relation ?? null,
    areaMatchConfidence: null,
    adAreaPostcodes: unique(adLocations.map((location) => location.postcode)),
    adAreaSuburbs: unique(adLocations.map((location) => location.suburb)),
    serviceAreaPostcodes: unique(
      serviceLocations.map((location) => location.postcode),
    ),
    serviceAreaSuburbs: unique(
      serviceLocations.map((location) => location.suburb),
    ),
    adType: cleanCustomerMetaDisplayText(row.ad_type),
    headline: cleanCustomerMetaDisplayText(row.headline),
    body: cleanCustomerMetaDisplayText(row.body),
    description: cleanCustomerMetaDisplayText(row.classification?.description),
    cta: cleanCustomerMetaDisplayText(row.cta),
    destinationUrl: null,
    media: normaliseMedia(row.id, row.media),
  };
}

function normaliseMedia(
  adId: string,
  media: AdDbMedia[],
): CustomerMetaAdLibraryMedia[] {
  if (!Array.isArray(media)) return [];
  return media.flatMap((asset) => {
    if (
      !asset?.id ||
      !asset.storageBucket ||
      asset.objectKey !== `sha256/${asset.sha256}` ||
      !/^[a-f0-9]{64}$/u.test(asset.sha256) ||
      !(asset.byteSize > 0) ||
      !asset.mimeType
    )
      return [];
    const kind =
      asset.kind === "video" || asset.mimeType.startsWith("video/")
        ? "video"
        : asset.kind === "image" ||
            asset.kind === "thumbnail" ||
            asset.mimeType.startsWith("image/")
          ? "image"
          : null;
    if (!kind) return [];
    return [
      {
        id: asset.id,
        kind,
        url: `/api/research/ads/${encodeURIComponent(adId)}/media/${encodeURIComponent(asset.id)}`,
        posterUrl: null,
      },
    ];
  });
}

function ownershipSubject(
  value: unknown,
  key: "agent" | "agency",
): OwnershipSubject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const subject = (value as Record<string, unknown>)[key];
  return subject && typeof subject === "object" && !Array.isArray(subject)
    ? (subject as OwnershipSubject)
    : null;
}

function attribution(
  subject: "agent" | "agency",
  value: OwnershipSubject | null,
): Record<string, unknown> | null {
  const id = clean(value?.id);
  if (!id) return null;
  return { subject, id, relationship: clean(value?.relationship) };
}

function normaliseLocations(
  value: unknown,
): Array<{
  id: string | null;
  postcode: string | null;
  suburb: string | null;
  state: string | null;
  relation: string;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const location = item as Location;
    const relation = clean(location.relation);
    if (!relation) return [];
    return [
      {
        id: clean(location.id),
        postcode: clean(location.postcode),
        suburb: cleanCustomerMetaDisplayText(location.suburb),
        state: clean(location.state),
        relation,
      },
    ];
  });
}

function compareLocationEvidence(
  a: { relation: string; id: string | null },
  b: { relation: string; id: string | null },
): number {
  const priority = {
    property: 0,
    copy_mention: 1,
    meta_targeting: 2,
  } as Record<string, number>;
  return (
    (priority[a.relation] ?? 9) - (priority[b.relation] ?? 9) ||
    (a.id ?? "").localeCompare(b.id ?? "")
  );
}

function activeStatus(value: string): "active" | "inactive" | "unknown" {
  if (value === "active") return "active";
  if (value === "inactive") return "inactive";
  return "unknown";
}
function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function unique(values: Array<string | null>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}
function isRecord(
  value: Record<string, unknown> | null,
): value is Record<string, unknown> {
  return value !== null;
}
