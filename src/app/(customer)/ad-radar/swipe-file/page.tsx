import { Bookmark, Images } from "lucide-react";
import Link from "next/link";

import { AdCardActions } from "@/components/research/ad-card-actions";
import { StatusPill } from "@/components/status-pill";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { loadCustomerAdsByIds, loadCustomerSavedResearchAds } from "@/lib/research/customer-ad-library-pages";

export const dynamic = "force-dynamic";

export default async function SwipeFilePage() {
  const { supabase } = await requirePageSurfaceAccess("monitor");
  const { saved, error } = await loadCustomerSavedResearchAds(supabase);
  const ads = await loadCustomerAdsByIds(supabase, saved.map((row) => row.observedAdId));

  return (
    <main className="content research-page swipe-file-page">
      <div className="row-between swipe-file-heading">
        <div>
          <p className="eyebrow">Competitor intelligence</p>
          <h1>Saved swipe file</h1>
          <p className="item-meta">Saved competitor ads ready to review or use as Ad Studio inspiration.</p>
        </div>
        <Link className="button secondary" href="/ad-radar">
          Back to ads
        </Link>
      </div>

      {error ? (
        <section className="panel research-blocker-card">
          <h2>Swipe file unavailable</h2>
          <p>Saved research ads could not be loaded right now.</p>
        </section>
      ) : null}

      <section className="panel">
        <div className="row-between swipe-file-panel-head">
          <h2>{saved.length} saved ad{saved.length === 1 ? "" : "s"}</h2>
          <Bookmark size={18} />
        </div>
        <div className="swipe-file-list">
          {saved.map((row) => {
            const ad = ads.find((item) => item.id === row.observedAdId);
            return (
              <article className="swipe-file-item" key={row.id}>
                <div className="swipe-file-main">
                  <div>
                    <strong>{ad?.creative.headline ?? ad?.page.name ?? "Saved research ad"}</strong>
                    <p>{truncate(ad?.creative.body ?? row.note ?? "No copy captured for this saved ad yet.", 220)}</p>
                  </div>
                  <div className="swipe-file-meta">
                    <StatusPill tone="blue">Saved</StatusPill>
                    <span>{formatDate(row.createdAt)}</span>
                  </div>
                </div>
                <div className="swipe-file-actions">
                  {ad ? (
                    <AdCardActions observedAdId={ad.id} libraryId={ad.libraryId} />
                  ) : (
                    <span className="muted">
                      <Images size={14} /> Original ad row is no longer available.
                    </span>
                  )}
                </div>
              </article>
            );
          })}
          {saved.length === 0 ? (
            <div className="research-empty-state">
              <h3>No saved ads yet</h3>
              <p>Save useful competitor ads from the Ad Radar grid and they will appear here.</p>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}
