import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { AdCardActions } from "@/components/research/ad-card-actions";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { loadCustomerResearchAdDetail } from "@/lib/research/customer-ad-library-pages";

export const dynamic = "force-dynamic";

export default async function ResearchAdDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requirePageSurfaceAccess("monitor");
  const { ad, versions, error } = await loadCustomerResearchAdDetail(supabase, id);

  if (error || !ad) {
    return (
      <main className="content research-page research-detail-page">
        <PageHeading eyebrow="Competitor intelligence" title="Ad not found" description="The selected research ad is no longer available in this workspace view." />
        <Link className="button secondary" href="/ad-radar">
          Back to Ad Radar
        </Link>
      </main>
    );
  }

  return (
    <main className="content research-page research-detail-page">
      <PageHeading
        eyebrow="Competitor intelligence"
        title={ad.creative.headline ?? ad.page.name}
        description={`Meta Library ${ad.libraryId ?? "ID unavailable"} from ${ad.page.name}.`}
      />

      <section className="panel research-detail-layout">
        <div className="research-detail-copy">
          <div className="row-between research-detail-head">
            <div>
              <h2>
                <Link href={`/ad-radar/advertisers/${ad.page.id}`}>{ad.page.name}</Link>
              </h2>
              <p className="item-meta">{[ad.agency.name, ad.agent.name].filter(Boolean).join(" / ") || "Advertiser page"}</p>
            </div>
            <StatusPill tone={ad.status.active === "active" ? "green" : ad.status.active === "inactive" ? "amber" : "blue"}>
              {ad.status.active}
            </StatusPill>
          </div>
          <dl className="research-detail-facts">
            <div>
              <dt>Format</dt>
              <dd>{ad.creative.format ?? "-"}</dd>
            </div>
            <div>
              <dt>Classification</dt>
              <dd>{[ad.creative.adType, ad.creative.primaryIntent].filter(Boolean).join(" / ") || "-"}</dd>
            </div>
            <div>
              <dt>First seen</dt>
              <dd>{formatDate(ad.dates.firstSeenAt)}</dd>
            </div>
            <div>
              <dt>Last seen</dt>
              <dd>{formatDate(ad.dates.lastSeenAt)}</dd>
            </div>
          </dl>
          {ad.creative.body ? <p className="research-detail-body">{ad.creative.body}</p> : null}
          <AdCardActions observedAdId={ad.id} libraryId={ad.libraryId} />
        </div>

        <div className="research-detail-media">
          {ad.media[0] ? (
            ad.media[0].kind === "video" ? (
              <video className="meta-ad-media" src={ad.media[0].url} controls preload="metadata" playsInline />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="meta-ad-media" src={ad.media[0].url} alt={ad.creative.headline ?? ad.page.name} />
            )
          ) : (
            <div className="meta-ad-text-only">
              <span>No stored media captured</span>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="row-between research-versions-head">
          <h2>Creative versions</h2>
          {ad.source.snapshotUrl ? (
            <a className="button secondary" href={ad.source.snapshotUrl} target="_blank" rel="noreferrer">
              Meta source <ExternalLink size={14} />
            </a>
          ) : null}
        </div>
        <div className="research-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Changed</th>
                <th>Format</th>
                <th>Type</th>
                <th>Intent</th>
                <th>Display</th>
                <th>Ad ID</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr key={version.id}>
                  <td>{version.version}</td>
                  <td>{formatDate(version.createdAt)}</td>
                  <td>{version.format ?? "-"}</td>
                  <td>{version.adType ?? "-"}</td>
                  <td>{version.primaryIntent ?? "-"}</td>
                  <td>{version.displayState ?? "-"}</td>
                  <td>
                    <span className="advertiser-ad-code">{version.creativeHash.slice(0, 16)}</span>
                  </td>
                </tr>
              ))}
              {versions.length === 0 ? (
                <tr>
                  <td colSpan={7}>No creative version history has been recorded for this ad.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("en-AU");
}
