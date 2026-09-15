import { ArrowRight, Clock3, Film, FolderOpen, ImageOff, LayoutTemplate, Palette } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { LibraryAdModel } from "@/lib/adbuilder/library-read-model";
import { Button } from "@/components/ui/button";
import { SafeImage } from "@/components/ui/safe-image";

type HomeCommandProps = {
  ads: LibraryAdModel[];
  adsError: boolean;
  timeZone: string;
  dateLocale: "en-AU" | "en-US";
  hasAvailableTemplates: boolean;
  templatesLoadError: boolean;
};

export function HomeCommand({ ads, adsError, timeZone, dateLocale, hasAvailableTemplates, templatesLoadError }: HomeCommandProps) {
  return (
    <div>
      {/*
        One name for this place, and it is the page's own heading. The rail says
        "Home"; this says what Home shows. The create action lives in the rail
        (see StudioShell) so it is reachable from every Ad Builder route and this
        page has no competing primary.
      */}
      <header className="flex min-h-11 items-center justify-between gap-4">
        <h1 id="recent-work-heading" className="font-display text-page-title-sm tracking-[-.025em] md:text-page-title">Recent ads</h1>
        <div className="flex shrink-0 items-center gap-3">
          {templatesLoadError ? (
            <Button asChild variant="destructive" className="min-h-11">
              <a href="/ad-builder/templates">Refresh templates</a>
            </Button>
          ) : null}
          <Link href="/ad-builder/library?view=ads" className="inline-flex min-h-11 items-center gap-1 text-[12px] font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            View all <ArrowRight size={15} aria-hidden />
          </Link>
        </div>
      </header>

      <section className="mt-4" aria-labelledby="recent-work-heading">
        {adsError ? <ReadError label="recent ads" /> : ads.length > 0 ? (
          <div className="divide-y divide-border overflow-hidden rounded-(--r-card) border border-border bg-card">
            {ads.slice(0, 3).map(ad => <RecentAd key={ad.adId} ad={ad} timeZone={timeZone} dateLocale={dateLocale} />)}
          </div>
        ) : (
          <div className="rounded-(--r-card) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 p-5 text-center">
            <h2 className="font-display text-section-title">No saved ads yet</h2>
            {templatesLoadError ? (
              <Button asChild variant="destructive" className="mt-3 min-h-11"><a href="/ad-builder/templates">Refresh templates</a></Button>
            ) : hasAvailableTemplates ? (
              <Button asChild className="mt-3 min-h-11"><Link href="/ad-builder/templates" aria-label="Create a new ad from a reviewed template">New ad</Link></Button>
            ) : (
              <Button asChild variant="outline" className="mt-3 min-h-11"><Link href="/ad-builder/brand">Review Brand Pack</Link></Button>
            )}
          </div>
        )}
      </section>

      {/*
        Phones only. On md+ the rail already owns these destinations, so this
        row is the complete builder navigation at narrow widths rather than a
        partial duplicate of the rail.
      */}
      <nav className="mt-6 grid grid-cols-2 gap-2 md:hidden" aria-label="Ad Builder links">
        <SecondaryLink href="/ad-builder/templates" icon={<LayoutTemplate aria-hidden />}>Templates</SecondaryLink>
        <SecondaryLink href="/ad-builder/video" icon={<Film aria-hidden />}>Video</SecondaryLink>
        <SecondaryLink href="/ad-builder/library?view=assets" icon={<FolderOpen aria-hidden />}>Photos &amp; logos</SecondaryLink>
        <SecondaryLink href="/ad-builder/brand" icon={<Palette aria-hidden />}>Brand Pack</SecondaryLink>
      </nav>
    </div>
  );
}

function SecondaryLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Button asChild variant="outline" className="min-h-11 min-w-0">
      <Link href={href}>
        {icon}
        <span className="truncate">{children}</span>
      </Link>
    </Button>
  );
}

function RecentAd({ ad, timeZone, dateLocale }: { ad: LibraryAdModel; timeZone: string; dateLocale: "en-AU" | "en-US" }) {
  const editorHref = `/ad-builder/ads/${encodeURIComponent(ad.adId)}`;
  const reviewHref = `/ad-builder/templates/${encodeURIComponent(ad.templateId)}/publish?adId=${encodeURIComponent(ad.adId)}`;

  return (
    <article className="flex min-w-0 items-center gap-3 p-3 sm:gap-4 sm:p-4">
      {/*
        The whole row is the way into the ad. There is no separate Edit control:
        two ways into the same place is what made this page read as a list of
        buttons. Review stays as the one secondary action beside it, and stays
        visible on phones so the publish path is not desktop-only.
      */}
      <Link href={editorHref} className="group flex min-w-0 flex-1 items-center gap-3 rounded-(--r-ctl) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-4">
        <AdThumbnail src={ad.src} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-component-title group-hover:underline">{ad.name}</span>
          <span className="mt-1 flex items-center gap-1.5 truncate text-meta text-muted-foreground"><Clock3 className="size-3.5 shrink-0" aria-hidden />{formatLastEdited(ad.updatedAt, timeZone, dateLocale)} · {ad.format}</span>
        </span>
      </Link>
      <Button asChild variant="outline" size="sm" className="shrink-0">
        <Link href={reviewHref}>Review</Link>
      </Button>
    </article>
  );
}

/*
 * The placeholder is painted under the image rather than swapped in after
 * `onLoad`: SafeImage owns the error path and exposes no load callback, and a
 * placeholder that is always present needs no state to stay correct. The image
 * is `relative` so it paints above the absolutely positioned placeholder once
 * the bytes arrive.
 */
function AdThumbnail({ src }: { src: string | null }) {
  return (
    <span className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-muted sm:size-16">
      <span className="absolute inset-0 grid place-items-center"><ImageOff className="size-4 text-muted-foreground" aria-hidden /></span>
      {src ? <SafeImage src={src} alt="" compactFallback loading="lazy" decoding="async" className="relative h-full w-full object-cover" /> : null}
    </span>
  );
}

function ReadError({ label }: { label: string }) {
  return <div className="mt-3 rounded-(--r-card) border border-(--ui-error)/25 bg-(--ui-error-soft) p-5 text-sm"><p className="font-semibold text-(--ui-error)">Couldn’t load {label}.</p><p className="mt-1 text-muted-foreground">Refresh to try again.</p></div>;
}

function formatLastEdited(value: string | null, timeZone: string, locale: "en-AU" | "en-US"): string {
  if (!value) return "recently";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(date);
}
