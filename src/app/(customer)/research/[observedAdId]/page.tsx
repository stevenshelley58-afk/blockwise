import { ArrowLeft, ExternalLink, History, MapPin, PlayCircle, Wand2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

type DetailRow = {
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

type AreaRow = { postcode: string; suburb: string; state: string };

export default async function ResearchAdDetailPage({
  params,
}: {
  params: Promise<{ observedAdId: string }>;
}) {
  const { supabase } = await requirePageSurfaceAccess("monitor");
  const { observedAdId } = await params;

  const research = supabase.schema("research");

  const { data: rows } = await research
    .from("v_agent_ad_history")
    .select(
      "observed_ad_id,external_ad_id,platform,active_status,first_seen_at,last_seen_at,page_id,page_name,page_url,agent_name,agency_name,format,headline,body,cta,cta_url,primary_image_url,video_url,landing_url,classification,snapshot_count",
    )
    .eq("observed_ad_id", observedAdId)
    .limit(1);
  const ad = (rows?.[0] ?? null) as (DetailRow & { snapshot_count: number }) | null;
  if (!ad) notFound();

  const { data: areaRows } = await research
    .from("ad_area_matches")
    .select("postcode,suburb,state")
    .eq("observed_ad_id", observedAdId)
    .order("confidence", { ascending: false });
  const areas = (areaRows ?? []) as AreaRow[];

  const adLibraryUrl = `https://www.facebook.com/ads/library/?id=${encodeURIComponent(ad.external_ad_id)}`;
  const daysRunning = Math.max(
    1,
    Math.round(
      (new Date(ad.last_seen_at).getTime() - new Date(ad.first_seen_at).getTime()) / 86_400_000,
    ),
  );

  return (
    <main className="content">
      <Link className="back-link" href="/research">
        <ArrowLeft size={14} /> Back to research
      </Link>
      <PageHeading
        eyebrow={ad.agency_name ?? ad.page_name}
        title={ad.headline ?? "Untitled ad"}
        description={ad.body ?? ""}
      />

      <section className="panel research-detail">
        <div className="research-detail-media">
          {ad.video_url ? (
            <video controls preload="metadata" poster={ad.primary_image_url ?? undefined}>
              <source src={ad.video_url} />
            </video>
          ) : ad.primary_image_url ? (
            <img src={ad.primary_image_url} alt={ad.headline ?? "Ad creative"} />
          ) : (
            <div className="research-card-media-empty">
              <PlayCircle size={32} aria-hidden />
            </div>
          )}
        </div>
        <div className="research-detail-info">
          <div className="row-between">
            <StatusPill tone={ad.active_status === "active" ? "green" : "amber"}>
              {ad.active_status}
            </StatusPill>
            <span className="item-meta">
              First seen {new Date(ad.first_seen_at).toLocaleDateString()} · {daysRunning} day
              {daysRunning === 1 ? "" : "s"} running · {ad.snapshot_count} snapshot
              {ad.snapshot_count === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="research-detail-facts">
            <li>
              <strong>Page</strong>
              <span>
                {ad.page_url ? (
                  <a href={ad.page_url} target="_blank" rel="noreferrer">
                    {ad.page_name} <ExternalLink size={12} />
                  </a>
                ) : (
                  ad.page_name
                )}
              </span>
            </li>
            <li>
              <strong>Agent</strong>
              <span>{ad.agent_name ?? "—"}</span>
            </li>
            <li>
              <strong>Platform</strong>
              <span>{ad.platform}</span>
            </li>
            <li>
              <strong>Format</strong>
              <span>{(ad.format ?? "unknown").toUpperCase()}</span>
            </li>
            <li>
              <strong>CTA</strong>
              <span>{ad.cta ?? "—"}</span>
            </li>
            <li>
              <strong>Landing URL</strong>
              <span>
                {ad.landing_url ? (
                  <a href={ad.landing_url} target="_blank" rel="noreferrer">
                    {ad.landing_url} <ExternalLink size={12} />
                  </a>
                ) : (
                  "—"
                )}
              </span>
            </li>
          </ul>
          <div className="research-detail-actions">
            <a className="btn-secondary" href={adLibraryUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> Meta Ad Library
            </a>
            <Link className="btn-primary" href={`/ad-studio?from=${encodeURIComponent(ad.observed_ad_id)}`}>
              <Wand2 size={14} /> Generate similar
            </Link>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>
          <MapPin size={14} aria-hidden /> Postcodes this ad covers
        </h2>
        {areas.length === 0 ? (
          <p className="item-meta">No targeting matches yet. The auditor will fill these in.</p>
        ) : (
          <ul className="chip-list">
            {areas.map((area) => (
              <li key={`${area.postcode}-${area.suburb}`} className="chip">
                {area.postcode} {area.suburb}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>
          <History size={14} aria-hidden /> Classification
        </h2>
        {!ad.classification || Object.keys(ad.classification).length === 0 ? (
          <p className="item-meta">
            Hermes' ad-classifier hasn't processed this creative yet. Tags appear here automatically on
            its next run.
          </p>
        ) : (
          <pre className="code-block">{JSON.stringify(ad.classification, null, 2)}</pre>
        )}
      </section>
    </main>
  );
}
