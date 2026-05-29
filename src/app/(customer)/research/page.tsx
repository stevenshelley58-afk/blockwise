import {
  Activity,
  Eye,
  Layers,
  PlayCircle,
  ScanSearch,
  Sparkles,
  Wand2,
} from "lucide-react";
import Link from "next/link";

import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

type ActiveAdRow = {
  postcode: string;
  suburb: string;
  state: string;
  observed_ad_id: string;
  external_ad_id: string;
  platform: string;
  active_status: string;
  first_seen_at: string;
  last_seen_at: string;
  page_id: string;
  page_name: string;
  page_url: string | null;
  agent_name: string | null;
  agency_name: string | null;
  format: string | null;
  headline: string | null;
  body: string | null;
  cta: string | null;
  cta_url: string | null;
  primary_image_url: string | null;
  video_url: string | null;
  landing_url: string | null;
  classification: Record<string, unknown> | null;
};

type PolicyRow = { postcode: string };

type SearchParams = {
  postcode?: string;
  format?: string;
  q?: string;
};

export default async function ResearchPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const { supabase } = await requirePageSurfaceAccess("monitor");
  const params = (searchParams ? await searchParams : {}) ?? {};
  const postcode = params.postcode?.trim() || "";
  const format = params.format?.trim() || "";
  const q = params.q?.trim() || "";

  // @ts-expect-error supabase-js typed schema not modelled
  const research = supabase.schema("research");

  let query = research
    .from("v_active_ads_by_postcode")
    .select(
      "postcode,suburb,state,observed_ad_id,external_ad_id,platform,active_status,first_seen_at,last_seen_at,page_id,page_name,page_url,agent_name,agency_name,format,headline,body,cta,cta_url,primary_image_url,video_url,landing_url,classification",
    )
    .order("last_seen_at", { ascending: false })
    .limit(48);
  if (postcode) query = query.eq("postcode", postcode);
  if (format) query = query.eq("format", format);
  if (q) query = query.or(`headline.ilike.%${q}%,body.ilike.%${q}%`);

  const [{ data: adsData }, { data: policiesData }] = await Promise.all([
    query,
    research
      .from("refresh_policies")
      .select("postcode")
      .eq("active", true)
      .order("priority")
      .order("postcode"),
  ]);
  const ads = (adsData ?? []) as ActiveAdRow[];
  const policies = (policiesData ?? []) as PolicyRow[];
  const seenAdIds = new Set<string>();
  const uniqueAds = ads.filter((ad) => {
    if (seenAdIds.has(ad.observed_ad_id)) return false;
    seenAdIds.add(ad.observed_ad_id);
    return true;
  });

  const totalActive = uniqueAds.length;
  const totalAgencies = new Set(uniqueAds.map((a) => a.agency_name).filter(Boolean)).size;
  const totalPostcodesCovered = new Set(uniqueAds.map((a) => a.postcode)).size;
  const lastRefresh = uniqueAds[0]?.last_seen_at;

  const filterActive = postcode || format || q;

  return (
    <main className="content">
      <PageHeading
        eyebrow="Competitor intelligence"
        title="Research"
        description="Live Meta ads from Australian real-estate advertisers, refreshed daily. Search by postcode, copy, or creative format. Click an ad to see its full history and similar creative."
      />

      <section className="grid cols-4">
        <MetricCard
          icon={Eye}
          label="Active ads"
          value={String(totalActive)}
          note={postcode ? `in postcode ${postcode}` : "across covered postcodes"}
        />
        <MetricCard
          icon={Activity}
          label="Agencies running"
          value={String(totalAgencies)}
          note={filterActive ? "matching your filter" : "across covered postcodes"}
        />
        <MetricCard
          icon={Layers}
          label="Postcodes shown"
          value={String(totalPostcodesCovered)}
          note={filterActive ? "filtered" : "with active ads"}
        />
        <MetricCard
          icon={Sparkles}
          label="Last refresh"
          value={lastRefresh ? new Date(lastRefresh).toLocaleString() : "—"}
          note="Apify pull cadence"
        />
      </section>

      <section className="panel">
        <form method="get" className="research-filters">
          <label className="research-filter">
            <span>Postcode</span>
            <select name="postcode" defaultValue={postcode}>
              <option value="">All covered</option>
              {policies.map((p) => (
                <option key={p.postcode} value={p.postcode}>
                  {p.postcode}
                </option>
              ))}
            </select>
          </label>
          <label className="research-filter">
            <span>Format</span>
            <select name="format" defaultValue={format}>
              <option value="">All</option>
              <option value="image">Image</option>
              <option value="video">Video</option>
              <option value="carousel">Carousel</option>
              <option value="dco">DCO</option>
            </select>
          </label>
          <label className="research-filter research-filter--grow">
            <span>Search copy</span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="e.g. open home, just sold, Subiaco"
            />
          </label>
          <button type="submit" className="btn-primary">
            <ScanSearch size={14} /> Apply
          </button>
          {filterActive ? (
            <Link href="/research" className="btn-secondary">
              Clear
            </Link>
          ) : null}
        </form>
      </section>

      {uniqueAds.length === 0 ? (
        <section className="panel">
          <h2>No matching ads</h2>
          <p>
            {filterActive
              ? "Your filter matched nothing in the live data. Try widening the postcode or removing the search term."
              : "The orchestrator hasn't seen anything that meets the active-ad criteria yet. New ads land here within minutes of the next Apify refresh."}
          </p>
          <p className="item-meta">
            Want to add an advertiser? File a missing-competitor report and the auditor will pick it up on
            the next pass.
          </p>
        </section>
      ) : (
        <section className="panel">
          <div className="row-between">
            <h2>
              Active ads{postcode ? ` in ${postcode}` : ""}{format ? ` · ${format}` : ""}
            </h2>
            <span className="item-meta">{uniqueAds.length} showing</span>
          </div>
          <div className="grid cols-3">
            {uniqueAds.map((ad) => (
              <AdCard key={ad.observed_ad_id} ad={ad} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function AdCard({ ad }: { ad: ActiveAdRow }) {
  const formatLabel = (ad.format ?? "unknown").toUpperCase();
  const formatTone =
    ad.format === "video" ? "blue" : ad.format === "carousel" ? "amber" : "green";
  const adLibraryUrl = `https://www.facebook.com/ads/library/?id=${encodeURIComponent(ad.external_ad_id)}`;
  return (
    <article className="item-card research-card">
      <div className="research-card-media">
        {ad.video_url ? (
          <div className="research-card-media-video">
            <PlayCircle size={28} aria-hidden />
            {ad.primary_image_url ? (
              <img
                src={ad.primary_image_url}
                alt={ad.headline ?? "Ad creative thumbnail"}
                loading="lazy"
              />
            ) : null}
          </div>
        ) : ad.primary_image_url ? (
          <img
            src={ad.primary_image_url}
            alt={ad.headline ?? "Ad creative"}
            loading="lazy"
          />
        ) : (
          <div className="research-card-media-empty" aria-hidden>
            <Sparkles size={24} />
          </div>
        )}
      </div>
      <div className="research-card-meta">
        <div className="row-between">
          <strong>{ad.agency_name ?? "Unknown agency"}</strong>
          <StatusPill tone={formatTone as "blue" | "amber" | "green"}>{formatLabel}</StatusPill>
        </div>
        <p className="item-meta">
          {ad.page_name} · {ad.platform} · {ad.postcode} {ad.suburb}
        </p>
        {ad.headline ? <h3 className="research-card-headline">{ad.headline}</h3> : null}
        {ad.body ? <p className="research-card-body">{ad.body}</p> : null}
        <div className="row-between research-card-actions">
          <Link className="btn-secondary" href={`/research/${ad.observed_ad_id}`}>
            Details
          </Link>
          <a
            className="btn-secondary"
            href={adLibraryUrl}
            target="_blank"
            rel="noreferrer"
          >
            View on Meta
          </a>
          <Link
            className="btn-primary"
            href={`/ad-studio?from=${encodeURIComponent(ad.observed_ad_id)}`}
          >
            <Wand2 size={14} /> Generate
          </Link>
        </div>
      </div>
    </article>
  );
}
