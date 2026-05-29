import { Clock3, ExternalLink, FileSearch, ImageIcon, MapPin, Search, Users } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type ActiveAdRow = {
  postcode: string | null;
  suburb: string | null;
  state: string | null;
  observed_ad_id: string;
  external_ad_id: string | null;
  active_status: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  last_checked_at?: string | null;
  ad_delivery_started_at?: string | null;
  advertiser_page_id: string | null;
  page_id: string | null;
  page_name: string | null;
  page_url: string | null;
  agency_name: string | null;
  agent_name: string | null;
  format: string | null;
  headline: string | null;
  body: string | null;
  cta: string | null;
  cta_url: string | null;
  primary_image_url: string | null;
  image_storage_path?: string | null;
  image_urls?: string[] | null;
  video_url: string | null;
  video_storage_path?: string | null;
  video_thumbnail_url?: string | null;
  media_assets?: unknown;
  landing_url: string | null;
  classification: unknown;
  ad_type?: string | null;
  primary_intent?: string | null;
  area_match_confidence: number | null;
};

type AdvertiserGroup = {
  key: string;
  pageName: string;
  agencyName: string;
  pageUrl: string | null;
  postcodes: string[];
  rows: ActiveAdRow[];
};

export default async function ResearchPage({ searchParams }: { searchParams?: SearchParams }) {
  const { supabase } = await requirePageSurfaceAccess("monitor");
  const params = searchParams ? await searchParams : {};
  const searchTerm = firstParam(params.q ?? params.postcode).trim();

  const { rows, loadError } = await loadActiveAds(supabase, searchTerm);
  const grouped = groupByAdvertiser(rows);
  const allPostcodes = unique(rows.map((row) => row.postcode).filter(Boolean) as string[]);
  const mediaReady = rows.filter((row) => Boolean(resolveMedia(row)?.url)).length;
  const newestSeenAt = rows
    .map((row) => row.last_seen_at)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <main className="content">
      <PageHeading
        eyebrow="Competitor intelligence"
        title="Research"
        description="Search live Australian real-estate ads by postcode, suburb, agency, agent, or ad copy."
      />

      <section className="panel research-search-panel">
        <form className="research-search-form" action="/research">
          <label htmlFor="research-query">
            Search
            <input
              id="research-query"
              name="q"
              defaultValue={searchTerm}
              placeholder="6008, Subiaco, Ray White, appraisal"
              autoComplete="off"
            />
          </label>
          <button className="button" type="submit">
            <Search size={14} /> Search
          </button>
        </form>
        <div className="research-freshness">
          <Clock3 size={14} />
          {newestSeenAt ? `Last seen ${formatDateTime(newestSeenAt)}` : "No live observations yet"}
        </div>
      </section>

      <section className="grid cols-4">
        <MetricCard icon={FileSearch} label="Ads in view" value={String(rows.length)} note="Deduped active observations" />
        <MetricCard icon={Users} label="Advertisers" value={String(grouped.length)} note="Pages with active ads" />
        <MetricCard icon={MapPin} label="Postcodes" value={String(allPostcodes.length)} note="Matched service areas" />
        <MetricCard icon={ImageIcon} label="Media visible" value={String(mediaReady)} note="Stored media or provider URL" />
      </section>

      {loadError ? (
        <section className="panel research-blocker-card">
          <h2>Research view unavailable</h2>
          <p>{loadError}</p>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-title-row">
          <div>
            <h2>{searchTerm ? `Results for "${searchTerm}"` : "Latest active ads"}</h2>
            <p className="item-meta">{rows.length} active ads across {grouped.length} advertiser pages.</p>
          </div>
        </div>

        <div className="research-advertiser-list">
          {grouped.map((group) => (
            <article className="research-advertiser-card item-card" key={group.key}>
              <div className="research-advertiser-header">
                <div>
                  <h3>{group.pageName}</h3>
                  <div className="research-page-row">
                    <span className="research-source-chip">{group.agencyName}</span>
                    {group.postcodes.map((postcode) => (
                      <span className="research-source-chip" key={postcode}>
                        {postcode}
                      </span>
                    ))}
                  </div>
                </div>
                {group.pageUrl ? (
                  <a className="button secondary" href={group.pageUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} /> Page
                  </a>
                ) : null}
              </div>

              <div className="research-ad-list">
                {group.rows.map((row) => (
                  <AdCard key={`${row.observed_ad_id}-${row.postcode ?? "all"}`} row={row} />
                ))}
              </div>
            </article>
          ))}
        </div>

        {grouped.length === 0 ? (
          <div className="research-empty-state">
            <h3>No active ads matched</h3>
            <p>Try a WA postcode such as 6008 or 6000 while the background collector expands coverage.</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function AdCard({ row }: { row: ActiveAdRow }) {
  const media = resolveMedia(row);
  const startedAt = row.ad_delivery_started_at ?? row.first_seen_at;
  const daysRunning = daysSince(startedAt);
  const title = row.headline || firstSentence(row.body) || "Ad creative captured";
  const destination = row.cta_url || row.landing_url || null;

  return (
    <article className="research-ad-row">
      <div className="research-ad-copy">
        <div className="research-match-row">
          <StatusPill tone={row.active_status === "active" ? "green" : "amber"}>{row.active_status ?? "unknown"}</StatusPill>
          <span className="research-source-chip">{classificationLabel(row)}</span>
          {daysRunning ? <span className="item-meta">Running {daysRunning} day{daysRunning === 1 ? "" : "s"}</span> : null}
          {row.area_match_confidence ? <span className="item-meta">Match {Math.round(row.area_match_confidence)}%</span> : null}
        </div>
        <h4>{title}</h4>
        {row.body ? <p>{truncate(row.body, 420)}</p> : <p className="item-meta">Copy was not present in the latest provider payload.</p>}
        <div className="research-match-row">
          {row.cta ? <span className="research-source-chip">{row.cta}</span> : null}
          {destination ? (
            <a href={destination} target="_blank" rel="noreferrer">
              Landing page <ExternalLink size={12} />
            </a>
          ) : null}
          {row.external_ad_id ? <span className="item-meta">Ad {row.external_ad_id}</span> : null}
        </div>
      </div>
      <div className="research-media-frame">
        {media?.kind === "video" ? (
          <video className="research-media" src={media.url} poster={media.posterUrl ?? undefined} controls preload="metadata" playsInline />
        ) : media?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="research-media" src={media.url} alt={title} loading="lazy" />
        ) : (
          <div className="research-media-empty">No media</div>
        )}
      </div>
    </article>
  );
}

async function loadActiveAds(
  supabase: Awaited<ReturnType<typeof requirePageSurfaceAccess>>["supabase"],
  searchTerm: string,
): Promise<{ rows: ActiveAdRow[]; loadError: string | null }> {
  const { data, error } = await supabase
    .schema("research")
    .from("v_active_ads_by_postcode")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .limit(500);

  if (error) {
    return { rows: [], loadError: error.message };
  }

  const allRows = ((data ?? []) as ActiveAdRow[]).filter((row) => row.observed_ad_id);
  const filtered = searchTerm
    ? allRows.filter((row) => rowMatches(row, searchTerm))
    : allRows.filter((row) => (row.state ?? "WA") === "WA");

  return { rows: dedupeAds(filtered).slice(0, 80), loadError: null };
}

function rowMatches(row: ActiveAdRow, searchTerm: string): boolean {
  const needle = searchTerm.toLowerCase();
  return [
    row.postcode,
    row.suburb,
    row.state,
    row.page_name,
    row.agency_name,
    row.agent_name,
    row.headline,
    row.body,
    row.cta,
    row.external_ad_id,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

function dedupeAds(rows: ActiveAdRow[]): ActiveAdRow[] {
  const seen = new Set<string>();
  const deduped: ActiveAdRow[] = [];
  for (const row of rows) {
    if (seen.has(row.observed_ad_id)) continue;
    seen.add(row.observed_ad_id);
    deduped.push(row);
  }
  return deduped;
}

function groupByAdvertiser(rows: ActiveAdRow[]): AdvertiserGroup[] {
  const groups = new Map<string, AdvertiserGroup>();
  for (const row of rows) {
    const key = row.advertiser_page_id ?? row.page_id ?? row.page_name ?? "unknown";
    const existing =
      groups.get(key) ??
      {
        key,
        pageName: row.page_name ?? "Unknown page",
        agencyName: row.agency_name ?? row.agent_name ?? "Unmatched agency",
        pageUrl: row.page_url,
        postcodes: [],
        rows: [],
      };
    if (row.postcode && !existing.postcodes.includes(row.postcode)) existing.postcodes.push(row.postcode);
    existing.rows.push(row);
    groups.set(key, existing);
  }
  return Array.from(groups.values()).sort((a, b) => b.rows.length - a.rows.length);
}

function resolveMedia(row: ActiveAdRow): { kind: "image" | "video"; url: string; posterUrl: string | null } | null {
  const assets = parseMediaAssets(row.media_assets);
  const storedVideo = row.video_storage_path ?? assets.find((asset) => asset.kind === "video" && asset.storagePath)?.storagePath ?? null;
  const storedImage = row.image_storage_path ?? assets.find((asset) => asset.kind === "image" && asset.storagePath)?.storagePath ?? null;
  const posterPath = assets.find((asset) => asset.kind === "thumbnail" && asset.storagePath)?.storagePath ?? null;

  if (storedVideo) {
    return {
      kind: "video",
      url: publicStorageUrl(storedVideo) ?? row.video_url ?? "",
      posterUrl: posterPath ? publicStorageUrl(posterPath) : publicStorageUrl(row.video_thumbnail_url ?? ""),
    };
  }
  if (storedImage) {
    return { kind: "image", url: publicStorageUrl(storedImage) ?? row.primary_image_url ?? "", posterUrl: null };
  }
  if (row.video_url) return { kind: "video", url: row.video_url, posterUrl: row.video_thumbnail_url ?? null };
  if (row.primary_image_url) return { kind: "image", url: row.primary_image_url, posterUrl: null };
  const assetUrl = assets.find((asset) => asset.url)?.url ?? null;
  if (assetUrl) return { kind: isVideoUrl(assetUrl) ? "video" : "image", url: assetUrl, posterUrl: null };
  return null;
}

function parseMediaAssets(value: unknown): Array<{ kind: string | null; storagePath: string | null; url: string | null }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((asset): asset is Record<string, unknown> => Boolean(asset) && typeof asset === "object")
    .map((asset) => ({
      kind: typeof asset.kind === "string" ? asset.kind : null,
      storagePath: typeof asset.storagePath === "string" ? asset.storagePath : typeof asset.storage_path === "string" ? asset.storage_path : null,
      url: typeof asset.url === "string" ? asset.url : typeof asset.sourceUrl === "string" ? asset.sourceUrl : null,
    }));
}

function publicStorageUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!supabaseUrl) return null;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl}/storage/v1/object/public/research-ad-creatives/${encodedPath}`;
}

function classificationLabel(row: ActiveAdRow): string {
  const classification = isRecord(row.classification) ? row.classification : {};
  const value =
    row.primary_intent ??
    row.ad_type ??
    stringValue(classification.primary_intent) ??
    stringValue(classification.ad_type) ??
    stringValue(classification.intent) ??
    row.format;
  return value ? value.replace(/_/g, " ") : "unclassified";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function firstSentence(value: string | null): string | null {
  if (!value) return null;
  return truncate(value.split(/[.!?]\s/)[0] ?? value, 96);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1).trim()}...` : value;
}

function daysSince(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(1, Math.ceil((Date.now() - timestamp) / 86_400_000));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isVideoUrl(url: string): boolean {
  return /\.mp4(?:$|\?)/i.test(url) || /video-/i.test(url);
}
