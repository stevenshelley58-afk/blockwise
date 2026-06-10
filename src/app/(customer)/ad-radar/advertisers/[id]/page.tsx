import Link from "next/link";

import { AdCardActions } from "@/components/research/ad-card-actions";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { loadCustomerAdvertiserAds } from "@/lib/research/customer-ad-library-pages";

export const dynamic = "force-dynamic";

export default async function AdvertiserProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requirePageSurfaceAccess("monitor");
  const { ads, error } = await loadCustomerAdvertiserAds(supabase, id);

  const first = ads[0] ?? null;
  const activeCount = ads.filter((ad) => ad.status.active === "active").length;
  const classifications = unique(ads.map((ad) => ad.creative.adType).filter((value): value is string => Boolean(value)));

  return (
    <main className="content research-page research-advertiser-page">
      <PageHeading
        eyebrow="Advertiser profile"
        title={first?.page.name ?? "Advertiser not found"}
        description={
          first
            ? `${ads.length} captured ad${ads.length === 1 ? "" : "s"}, ${activeCount} active, ${classifications.length} classification${classifications.length === 1 ? "" : "s"}.`
            : "No visible ad history is available for this advertiser page."
        }
      />

      <div className="row-between research-advertiser-bar">
        <Link className="button secondary" href="/ad-radar">
          Back to ads
        </Link>
        <span className="advertiser-ad-code">{id}</span>
      </div>

      {error ? (
        <section className="panel research-blocker-card">
          <h2>Profile unavailable</h2>
          <p>Advertiser history could not be loaded right now.</p>
        </section>
      ) : null}

      <section className="panel">
        <h2>Ad history</h2>
        <div className="swipe-file-list">
          {ads.map((ad) => (
            <article className="swipe-file-item" key={ad.id}>
              <div className="swipe-file-main">
                <div>
                  <strong>{ad.creative.headline ?? ad.page.name}</strong>
                  <p>{truncate(ad.creative.body ?? "No primary copy captured.", 220)}</p>
                </div>
                <div className="swipe-file-meta">
                  <StatusPill tone={ad.status.active === "active" ? "green" : ad.status.active === "inactive" ? "amber" : "blue"}>
                    {ad.status.active}
                  </StatusPill>
                  <span>{formatDate(ad.dates.lastSeenAt)}</span>
                </div>
              </div>
              <div className="swipe-file-actions">
                <AdCardActions observedAdId={ad.id} libraryId={ad.libraryId} />
              </div>
            </article>
          ))}
          {ads.length === 0 ? (
            <div className="research-empty-state">
              <h3>No ads captured</h3>
              <p>This advertiser page has no visible ad history in the Blockwise research database.</p>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}
