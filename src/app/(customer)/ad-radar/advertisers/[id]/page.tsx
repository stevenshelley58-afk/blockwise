import Link from "next/link";
import { notFound } from "next/navigation";

import { AdCardActions } from "@/components/research/ad-card-actions";
import { StatusPill } from "@/components/status-pill";
import { niche } from "@/config/niche";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { loadCustomerAdvertiserAds } from "@/lib/research/customer-ad-library-pages";

export const dynamic = "force-dynamic";

const ghostButtonClass =
  "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-(--line-heavy) bg-card px-3.5 text-[12.5px] font-bold text-foreground transition-[background,box-shadow] duration-150 hover:bg-(--surface-subtle) hover:shadow-card";

export default async function AdvertiserProfilePage({ params }: { params: Promise<{ id: string }> }) {
  if (!niche.features.adRadar) notFound();
  const { id } = await params;
  const { supabase } = await requirePageSurfaceAccess("monitor");
  const { ads, error } = await loadCustomerAdvertiserAds(supabase, id);

  const first = ads[0] ?? null;
  const activeCount = ads.filter((ad) => ad.status.active === "active").length;
  const classifications = unique(ads.map((ad) => ad.creative.adType).filter((value): value is string => Boolean(value)));

  return (
    <main className="mx-auto grid w-full max-w-[1120px] gap-3.5 px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16">
      <header>
        <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">Advertiser profile</p>
        <h1 className="mt-1 font-display text-[24px] font-extrabold tracking-[-0.02em] md:text-[27px]">
          {first?.page.name ?? "Advertiser not found"}
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {first
            ? `${ads.length} captured ad${ads.length === 1 ? "" : "s"}, ${activeCount} active, ${classifications.length} classification${classifications.length === 1 ? "" : "s"}.`
            : "No visible ad history is available for this advertiser page."}
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link className={ghostButtonClass} href="/ad-radar">
          Back to ads
        </Link>
        <span className="rounded-lg bg-(--surface-subtle) px-2.5 py-1 font-mono text-[11px] font-medium text-(--faint)">
          {id}
        </span>
      </div>

      {error ? (
        <section className="rounded-(--r-panel) border border-error/25 bg-error-soft p-5">
          <h2 className="font-display text-[15.5px] font-extrabold tracking-[-0.015em] text-error">Profile unavailable</h2>
          <p className="mt-1 text-xs text-error/80">Advertiser history could not be loaded right now.</p>
        </section>
      ) : null}

      <section className="rounded-(--r-panel) border border-(--line) bg-(--surface) p-5 shadow-card">
        <h2 className="font-display text-[15.5px] font-extrabold tracking-[-0.015em]">Ad history</h2>
        <div className="mt-3.5 grid gap-2.5">
          {ads.map((ad) => (
            <article className="grid gap-3 rounded-(--r-card) border border-(--line) bg-(--surface-subtle)/40 p-4" key={ad.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <strong className="text-[13.5px] font-bold text-foreground">{ad.creative.headline ?? ad.page.name}</strong>
                  <p className="mt-1 text-xs/relaxed text-muted-foreground">
                    {truncate(ad.creative.body ?? "No primary copy captured.", 220)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <StatusPill tone={ad.status.active === "active" ? "green" : ad.status.active === "inactive" ? "amber" : "blue"}>
                    {ad.status.active}
                  </StatusPill>
                  <span className="text-[11.5px] text-(--faint)">{formatDate(ad.dates.lastSeenAt)}</span>
                </div>
              </div>
              <div>
                <AdCardActions observedAdId={ad.id} libraryId={ad.libraryId} />
              </div>
            </article>
          ))}
          {ads.length === 0 ? (
            <div className="rounded-(--r-card) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 px-6 py-10 text-center">
              <h3 className="font-display text-[15.5px] font-extrabold">No ads captured</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                This advertiser page has no visible ad history in the Blockwise research database.
              </p>
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
