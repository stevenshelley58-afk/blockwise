import {
  Activity,
  AlertOctagon,
  Bot,
  ChevronRight,
  ExternalLink,
  PauseOctagon,
  RefreshCcw,
  ShieldCheck,
  Signal,
} from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

type CoverageRow = {
  postcode: string;
  state: string;
  priority: number;
  refresh_cadence_minutes: number;
  last_refreshed_at: string | null;
  next_refresh_at: string;
  policy_active: boolean;
  last_audit_status: string | null;
  last_audit_score: number | null;
  last_audited_at: string | null;
  live_active_ads: number;
  live_advertiser_pages?: number;
  live_agents?: number;
  live_agencies?: number;
  listings?: number;
  health: string;
};

type RunRow = {
  id: string;
  source_provider: string;
  role: string;
  target_kind: string;
  target_value: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  cost_usd: number | null;
  result_summary: Record<string, unknown> | null;
  error: string | null;
};

type DefectRow = {
  id: string;
  postcode: string | null;
  suburb: string | null;
  agency_name: string | null;
  agent_name: string | null;
  platform: string | null;
  notes: string;
  reported_by: string;
  status: string;
  created_at: string;
};

type AdLibraryCardRow = {
  active_status: string | null;
  image_storage_path: string | null;
  video_storage_path: string | null;
  media_assets: unknown;
};

type AdLibraryStats = {
  activeCards: number;
  totalCards: number;
  cardsWithStoredMedia: number;
};

type EntityCounts = {
  agents: number;
  advertiserPages: number;
};

type RecentAdRow = {
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

const RECENT_AD_SELECT =
  "agency_id,agency_name,agent_id,agent_name,advertiser_page_id,page_name,platform,observed_ad_id,external_ad_id,active_status,first_seen_at,last_seen_at,last_checked_at,headline,body,cta,primary_image_url,video_url,format,classification,snapshot_count,ad_delivery_started_at,ad_delivery_stopped_at,ad_creation_date,image_urls,image_storage_path,video_storage_path,video_thumbnail_url,media_assets,ad_type,primary_intent,display_state";

async function loadCoverage(supabase: Awaited<ReturnType<typeof requirePageSurfaceAccess>>["supabase"]) {
  const { data } = await supabase.schema("research").from("v_coverage_status").select("*").order("priority").order("postcode");
  return (data ?? []) as CoverageRow[];
}

async function loadRuns(supabase: Awaited<ReturnType<typeof requirePageSurfaceAccess>>["supabase"]) {
  const { data } = await supabase
    .schema("research")
    .from("ad_fetch_runs")
    .select("id,source_provider,role,target_kind,target_value,started_at,completed_at,status,cost_usd,result_summary,error")
    .order("started_at", { ascending: false })
    .limit(20);
  return (data ?? []) as RunRow[];
}

async function loadDefects(supabase: Awaited<ReturnType<typeof requirePageSurfaceAccess>>["supabase"]) {
  const { data } = await supabase.schema("research").from("v_missing_competitors").select("*").limit(30);
  return (data ?? []) as DefectRow[];
}

async function loadAdLibraryStats(supabase: Awaited<ReturnType<typeof requirePageSurfaceAccess>>["supabase"]): Promise<AdLibraryStats> {
  const { data } = await supabase
    .schema("research")
    .from("v_customer_meta_ad_library_cards")
    .select("active_status,image_storage_path,video_storage_path,media_assets")
    .limit(1000);

  const rows = (data ?? []) as AdLibraryCardRow[];

  return {
    activeCards: rows.filter((row) => String(row.active_status ?? "").toLowerCase() === "active").length,
    totalCards: rows.length,
    cardsWithStoredMedia: rows.filter(hasStoredMedia).length,
  };
}

async function loadEntityCounts(supabase: Awaited<ReturnType<typeof requirePageSurfaceAccess>>["supabase"]): Promise<EntityCounts> {
  const [{ count: agents }, { count: advertiserPages }] = await Promise.all([
    supabase.schema("research").from("agents").select("id", { count: "exact", head: true }),
    supabase.schema("research").from("advertiser_pages").select("id", { count: "exact", head: true }),
  ]);

  return {
    agents: agents ?? 0,
    advertiserPages: advertiserPages ?? 0,
  };
}

async function loadRecentAds(supabase: Awaited<ReturnType<typeof requirePageSurfaceAccess>>["supabase"]) {
  const { data } = await supabase
    .schema("research")
    .from("v_agent_ad_history")
    .select(RECENT_AD_SELECT)
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(50);

  return (data ?? []) as unknown as RecentAdRow[];
}

export default async function OperatorResearchPage() {
  const { supabase } = await requirePageSurfaceAccess("operator");
  const [coverage, runs, defects, adLibraryStats, entityCounts, recentAds] = await Promise.all([
    loadCoverage(supabase).catch(() => [] as CoverageRow[]),
    loadRuns(supabase).catch(() => [] as RunRow[]),
    loadDefects(supabase).catch(() => [] as DefectRow[]),
    loadAdLibraryStats(supabase).catch(() => ({ activeCards: 0, totalCards: 0, cardsWithStoredMedia: 0 })),
    loadEntityCounts(supabase).catch(() => ({ agents: 0, advertiserPages: 0 })),
    loadRecentAds(supabase).catch(() => [] as RecentAdRow[]),
  ]);

  const postcodeMatchedAds = coverage.reduce((acc, r) => acc + (r.live_active_ads ?? 0), 0);
  const openDefects = defects.length;
  const failedRunsLast20 = runs.filter((r) => r.status === "failed").length;
  const totalCost24h = runs
    .filter((r) => new Date(r.started_at).getTime() > Date.now() - 24 * 3600 * 1000)
    .reduce((a, r) => a + (Number(r.cost_usd) || 0), 0);

  return (
    <main className="content">
      <PageHeading
        eyebrow="Research engine"
        title="Operator control"
        description="Live coverage, fetch runs, defects, and the kill switch for the Hermes-driven research engine."
      />

      <section className="grid cols-4">
        <MetricCard icon={Signal} label="Active ad cards" value={String(adLibraryStats.activeCards)} note={`${adLibraryStats.totalCards} customer-visible cards`} />
        <MetricCard icon={Activity} label="Postcode-matched ads" value={String(postcodeMatchedAds)} note="Coverage rows, not the library total" />
        <MetricCard icon={Bot} label="Known agents" value={String(entityCounts.agents)} note={`${entityCounts.advertiserPages} advertiser pages`} />
        <MetricCard icon={AlertOctagon} label="Open defects" value={String(openDefects)} note={`${failedRunsLast20} failed runs in last 20`} />
      </section>

      <section className="panel">
        <h2>Hermes runtime</h2>
        <div className="grid cols-3">
          <article className="item-card">
            <h3>Media archive</h3>
            <p className="item-meta">{adLibraryStats.cardsWithStoredMedia} cards have stored creative media.</p>
          </article>
          <article className="item-card">
            <h3>Scheduler</h3>
            <p className="item-meta">${totalCost24h.toFixed(2)} collector spend in the last 24h.</p>
          </article>
          <article className="item-card">
            <h3>Access</h3>
            <p className="item-meta">Hermes controls are inside Blockwise Research Ops.</p>
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="row-between">
          <h2>Recent ads</h2>
          <span className="muted">{recentAds.length} latest ingested rows</span>
        </div>
        <div className="table-wrap operator-ad-list-wrap">
          <table className="table operator-ad-list">
            <thead>
              <tr>
                <th>Creative</th>
                <th>Page</th>
                <th>Agent</th>
                <th>Agency</th>
                <th>Platform</th>
                <th>Status</th>
                <th>Display</th>
                <th>Type</th>
                <th>Intent</th>
                <th>Format</th>
                <th>CTA</th>
                <th>Started</th>
                <th>Stopped</th>
                <th>Created</th>
                <th>First seen</th>
                <th>Last seen</th>
                <th>Checked</th>
                <th>Snapshots</th>
                <th>External ad ID</th>
                <th>Observed ad ID</th>
                <th>Advertiser page ID</th>
                <th>Media</th>
                <th>Classification</th>
              </tr>
            </thead>
            <tbody>
              {recentAds.map((ad) => {
                const thumbnailUrl = resolveAdThumbnailUrl(ad);
                const libraryUrl = ad.external_ad_id
                  ? `https://www.facebook.com/ads/library/?id=${encodeURIComponent(ad.external_ad_id)}`
                  : null;
                const headline = cleanString(ad.headline) ?? cleanString(ad.body) ?? ad.external_ad_id ?? "Untitled ad";
                const body = cleanString(ad.body);

                return (
                  <tr key={ad.observed_ad_id}>
                    <td className="operator-ad-thumbnail-cell">
                      <div className="operator-ad-creative">
                        {thumbnailUrl ? (
                          <img className="operator-ad-thumb" src={thumbnailUrl} alt="" loading="lazy" />
                        ) : (
                          <span className="operator-ad-thumb operator-ad-thumb-placeholder">No media</span>
                        )}
                        <div className="operator-ad-primary">
                          <strong>{truncate(headline, 90)}</strong>
                          {body ? <span>{truncate(body, 160)}</span> : null}
                          {libraryUrl ? (
                            <a className="operator-ad-link" href={libraryUrl} target="_blank" rel="noreferrer">
                              Meta library <ExternalLink size={12} />
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td>{ad.page_name ?? "-"}</td>
                    <td>{ad.agent_name ?? "-"}</td>
                    <td>{ad.agency_name ?? "-"}</td>
                    <td>{ad.platform ?? "-"}</td>
                    <td>
                      <StatusPill tone={adStatusTone(ad.active_status)}>{ad.active_status ?? "unknown"}</StatusPill>
                    </td>
                    <td>{ad.display_state ?? "-"}</td>
                    <td>{ad.ad_type ?? "-"}</td>
                    <td>{ad.primary_intent ?? "-"}</td>
                    <td>{ad.format ?? "-"}</td>
                    <td>{ad.cta ?? "-"}</td>
                    <td>{formatDateTime(ad.ad_delivery_started_at)}</td>
                    <td>{formatDateTime(ad.ad_delivery_stopped_at)}</td>
                    <td>{formatDateTime(ad.ad_creation_date)}</td>
                    <td>{formatDateTime(ad.first_seen_at)}</td>
                    <td>{formatDateTime(ad.last_seen_at)}</td>
                    <td>{formatDateTime(ad.last_checked_at)}</td>
                    <td>{ad.snapshot_count ?? 0}</td>
                    <td>
                      <span className="operator-ad-code">{ad.external_ad_id ?? "-"}</span>
                    </td>
                    <td>
                      <span className="operator-ad-code">{ad.observed_ad_id}</span>
                    </td>
                    <td>
                      <span className="operator-ad-code">{ad.advertiser_page_id}</span>
                    </td>
                    <td>
                      <span className="operator-ad-json">{formatMediaSummary(ad)}</span>
                    </td>
                    <td>
                      <span className="operator-ad-json">{formatClassificationSummary(ad.classification)}</span>
                    </td>
                  </tr>
                );
              })}
              {recentAds.length === 0 && (
                <tr>
                  <td colSpan={23}>No ingested ads yet. Collector output will appear here after the next successful run.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="row-between">
          <h2>Coverage status</h2>
          <form method="post" action="/api/operator/research/kill-switch">
            <input type="hidden" name="paused" value="true" />
            <button className="button secondary" type="submit">
              <PauseOctagon size={14} /> Pause scheduler
            </button>
          </form>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Postcode</th>
              <th>Priority</th>
              <th>Cadence</th>
              <th>Last run</th>
              <th>Active ads</th>
              <th>Pages</th>
              <th>Health</th>
              <th>Audit</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {coverage.map((row) => (
              <tr key={`${row.postcode}-${row.state}`}>
                <td>
                  {row.postcode} <span className="muted">{row.state}</span>
                </td>
                <td>{row.priority}</td>
                <td>{row.refresh_cadence_minutes} min</td>
                <td>{row.last_refreshed_at ? new Date(row.last_refreshed_at).toLocaleString() : "—"}</td>
                <td>{row.live_active_ads}</td>
                <td>{row.live_advertiser_pages}</td>
                <td>
                  <StatusPill tone={healthTone(row.health)}>{row.health}</StatusPill>
                </td>
                <td>{row.last_audit_status ? `${row.last_audit_status} (${row.last_audit_score ?? 0})` : "never"}</td>
                <td>
                  <form method="post" action="/api/operator/research/refresh-now">
                    <input type="hidden" name="scope" value="postcode" />
                    <input type="hidden" name="value" value={row.postcode} />
                    <button className="button secondary" type="submit">
                      <RefreshCcw size={14} /> Run
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {coverage.length === 0 && (
              <tr>
                <td colSpan={9}>No postcodes configured. Insert into research.refresh_policies to begin.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Recent fetch runs</h2>
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Provider</th>
              <th>Target</th>
              <th>Status</th>
              <th>Cost</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.started_at).toLocaleString()}</td>
                <td>{r.source_provider}</td>
                <td>
                  <span className="muted">{r.target_kind}</span> {r.target_value.slice(0, 20)}
                </td>
                <td>
                  <StatusPill tone={r.status === "success" ? "green" : r.status === "failed" ? "rose" : "amber"}>
                    {r.status}
                  </StatusPill>
                </td>
                <td>${(Number(r.cost_usd) || 0).toFixed(4)}</td>
                <td>
                  {r.result_summary ? (
                    <span>
                      new {String((r.result_summary as Record<string, unknown>).adsNew ?? 0)}, upd{" "}
                      {String((r.result_summary as Record<string, unknown>).adsUpdated ?? 0)}, miss{" "}
                      {String((r.result_summary as Record<string, unknown>).adsMissing ?? 0)}
                    </span>
                  ) : r.error ? (
                    <span className="muted">{r.error.slice(0, 80)}</span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={6}>No fetch runs yet. The orchestrator will start logging here on first tick.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Open coverage defects</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Where</th>
              <th>Agent / Agency</th>
              <th>Notes</th>
              <th>Reporter</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {defects.map((d) => (
              <tr key={d.id}>
                <td>
                  {d.postcode ?? "—"} {d.suburb ? `(${d.suburb})` : ""}
                </td>
                <td>{d.agent_name ?? d.agency_name ?? "—"}</td>
                <td>{d.notes.slice(0, 120)}</td>
                <td>{d.reported_by}</td>
                <td>
                  <StatusPill tone={d.status === "open" ? "rose" : "amber"}>{d.status}</StatusPill>
                </td>
                <td>
                  <a className="button secondary" href={`/operator/research/defects/${d.id}`}>
                    Investigate <ChevronRight size={14} />
                  </a>
                </td>
              </tr>
            ))}
            {defects.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <ShieldCheck size={14} /> No open coverage defects. Auditor will populate this when it next runs.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function hasStoredMedia(row: AdLibraryCardRow): boolean {
  return Boolean(
    row.image_storage_path ||
      row.video_storage_path ||
      (Array.isArray(row.media_assets) && row.media_assets.length > 0),
  );
}

function resolveAdThumbnailUrl(row: RecentAdRow): string | null {
  return (
    mediaUrl(row.primary_image_url) ??
    mediaUrl(row.video_thumbnail_url) ??
    firstArrayUrl(row.image_urls) ??
    firstMediaAssetUrl(row.media_assets)
  );
}

function firstArrayUrl(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  for (const item of value) {
    const url = mediaUrl(item);
    if (url) {
      return url;
    }
  }

  return null;
}

function firstMediaAssetUrl(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const preferredKeys = ["thumbnail_url", "thumbnailUrl", "public_url", "publicUrl", "source_url", "sourceUrl", "url"];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const asset = item as Record<string, unknown>;
    for (const key of preferredKeys) {
      const url = mediaUrl(asset[key]);
      if (url) {
        return url;
      }
    }
  }

  return null;
}

function mediaUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return /^https?:\/\//iu.test(trimmed) ? trimmed : null;
}

function formatMediaSummary(row: RecentAdRow): string {
  const imageUrlCount = Array.isArray(row.image_urls) ? row.image_urls.length : 0;
  const mediaAssetCount = Array.isArray(row.media_assets) ? row.media_assets.length : 0;
  const parts = [
    row.primary_image_url ? "primary image" : null,
    row.video_thumbnail_url ? "video thumb" : null,
    row.video_url ? "video" : null,
    row.image_storage_path ? `image storage: ${row.image_storage_path}` : null,
    row.video_storage_path ? `video storage: ${row.video_storage_path}` : null,
    imageUrlCount ? `${imageUrlCount} image urls` : null,
    mediaAssetCount ? `${mediaAssetCount} media assets` : null,
  ].filter(Boolean);

  return parts.length ? truncate(parts.join(", "), 220) : "-";
}

function formatClassificationSummary(classification: RecentAdRow["classification"]): string {
  if (!classification || Object.keys(classification).length === 0) {
    return "-";
  }

  const hooks = Array.isArray(classification.hooks)
    ? classification.hooks.filter((hook): hook is string => typeof hook === "string")
    : [];
  const parts = [
    cleanString(classification.industry),
    cleanString(classification.type ?? classification.ad_type),
    cleanString(classification.primary_intent ?? classification.intent),
    typeof classification.confidence === "number" ? `confidence ${Math.round(classification.confidence * 100)}%` : null,
    hooks.length ? `hooks: ${hooks.slice(0, 3).join(", ")}` : null,
    cleanString(classification.rejection_reason),
  ].filter(Boolean);

  return truncate(parts.length ? parts.join(", ") : JSON.stringify(classification), 220);
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function adStatusTone(status: string | null): "green" | "amber" | "rose" | "blue" {
  const normalized = status?.toLowerCase();

  if (normalized === "active") {
    return "green";
  }

  if (normalized === "inactive") {
    return "amber";
  }

  if (normalized === "failed" || normalized === "rejected") {
    return "rose";
  }

  return "blue";
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function healthTone(health: string): "green" | "amber" | "rose" | "blue" {
  switch (health) {
    case "healthy":
      return "green";
    case "refresh_overdue":
    case "audit_overdue":
      return "amber";
    case "gap_known":
      return "rose";
    case "never_audited":
    default:
      return "blue";
  }
}
