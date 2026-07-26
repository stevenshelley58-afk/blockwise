import { Bookmark, Images } from "lucide-react";
import Link from "next/link";

import { AdCardActions } from "@/components/research/ad-card-actions";
import { StatusPill } from "@/components/status-pill";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { loadCustomerAdsByIds, loadCustomerSavedResearchAds } from "@/lib/research/customer-ad-library-pages";

export const dynamic = "force-dynamic";

const ghostButtonClass =
  "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-(--line-heavy) bg-card px-3.5 text-[12.5px] font-bold text-foreground transition-[background,box-shadow] duration-150 hover:bg-(--surface-subtle) hover:shadow-card";

export default async function SwipeFilePage() {
  const { supabase } = await requirePageSurfaceAccess("monitor");
  const { saved, error } = await loadCustomerSavedResearchAds(supabase);
  const ads = await loadCustomerAdsByIds(supabase, saved.map((row) => row.observedAdId));

  return (
    <main className="mx-auto grid w-full max-w-[1120px] gap-3.5 px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">
            Competitor intelligence
          </p>
          <h1 className="mt-1 font-display text-[24px] font-extrabold tracking-[-0.02em] md:text-[27px]">
            Saved swipe file
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Saved competitor ads ready to review or use as Ad Studio inspiration.
          </p>
        </div>
        <Link className={ghostButtonClass} href="/ad-radar">
          Back to ads
        </Link>
      </header>

      {error ? (
        <section className="rounded-(--r-panel) border border-error/25 bg-error-soft p-5">
          <h2 className="font-display text-[15.5px] font-extrabold tracking-[-0.015em] text-error">
            Swipe file unavailable
          </h2>
          <p className="mt-1 text-xs text-error/80">Saved research ads could not be loaded right now.</p>
        </section>
      ) : null}

      <section className="rounded-(--r-panel) border border-(--line) bg-(--surface) p-5 shadow-card">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-[15.5px] font-extrabold tracking-[-0.015em]">
            {saved.length} saved ad{saved.length === 1 ? "" : "s"}
          </h2>
          <Bookmark size={17} aria-hidden className="text-(--faint)" />
        </div>
        <div className="mt-3.5 grid gap-2.5">
          {saved.map((row) => {
            const ad = ads.find((item) => item.id === row.observedAdId);
            return (
              <article className="grid gap-3 rounded-(--r-card) border border-(--line) bg-(--surface-subtle)/40 p-4" key={row.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <strong className="text-[13.5px] font-bold text-foreground">
                      {ad?.creative.headline ?? ad?.page.name ?? "Saved research ad"}
                    </strong>
                    <p className="mt-1 text-xs/relaxed text-muted-foreground">
                      {truncate(ad?.creative.body ?? row.note ?? "No copy captured for this saved ad yet.", 220)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <StatusPill tone="blue">Saved</StatusPill>
                    <span className="text-[11.5px] text-(--faint)">{formatDate(row.createdAt)}</span>
                  </div>
                </div>
                <div>
                  {ad ? (
                    <AdCardActions observedAdId={ad.id} libraryId={ad.libraryId} />
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-(--faint)">
                      <Images size={13} aria-hidden /> Original ad row is no longer available.
                    </span>
                  )}
                </div>
              </article>
            );
          })}
          {saved.length === 0 ? (
            <div className="rounded-(--r-card) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 px-6 py-10 text-center">
              <h3 className="font-display text-[15px] font-extrabold">No saved ads yet</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Save useful competitor ads from the Ad Radar grid and they will appear here.
              </p>
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
