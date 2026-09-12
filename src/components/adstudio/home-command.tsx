import { ArrowRight, Clock3, FolderOpen, Image as ImageIcon, LayoutTemplate, Palette, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { LibraryAdModel } from "@/lib/adstudio/library-read-model";
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
      <header className="flex min-h-11 items-center justify-between gap-4">
        <h1 className="font-display text-[clamp(26px,4vw,34px)] font-extrabold tracking-[-.025em]">Ads</h1>
        {templatesLoadError ? (
          <Button asChild variant="destructive" className="min-h-11 shrink-0">
            <a href="/ad-studio/templates">Refresh templates</a>
          </Button>
        ) : hasAvailableTemplates ? (
          <Button asChild className="min-h-11 shrink-0">
            <Link href="/ad-studio/templates" aria-label="Create a new ad from a reviewed template">
              <Plus className="size-4" aria-hidden />
              New ad
            </Link>
          </Button>
        ) : (
          <Button asChild variant="outline" className="min-h-11 shrink-0">
            <Link href="/ad-studio/brand">Review Brand Pack</Link>
          </Button>
        )}
      </header>

      <section className="mt-7" aria-labelledby="recent-work-heading">
        <div className="flex items-center justify-between gap-4">
          <h2 id="recent-work-heading" className="font-display text-[17px] font-extrabold">Recent ads</h2>
          <Link href="/ad-studio/library?view=ads" className="inline-flex min-h-11 items-center gap-1 text-[12px] font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            View all <ArrowRight size={15} aria-hidden />
          </Link>
        </div>
        {adsError ? <ReadError label="recent ads" /> : ads.length > 0 ? (
          <div className="mt-3 divide-y divide-border overflow-hidden rounded-(--r-card) border border-border bg-card">
            {ads.slice(0, 3).map(ad => <RecentAd key={ad.adId} ad={ad} timeZone={timeZone} dateLocale={dateLocale} />)}
          </div>
        ) : (
          <div className="mt-3 rounded-(--r-card) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 p-5 text-center">
            <h3 className="font-display text-[15.5px] font-extrabold">No saved ads yet</h3>
            {templatesLoadError ? (
              <Button asChild variant="destructive" className="mt-3 min-h-11"><a href="/ad-studio/templates">Refresh templates</a></Button>
            ) : hasAvailableTemplates ? (
              <Button asChild className="mt-3 min-h-11"><Link href="/ad-studio/templates">New ad</Link></Button>
            ) : (
              <Button asChild variant="outline" className="mt-3 min-h-11"><Link href="/ad-studio/brand">Review Brand Pack</Link></Button>
            )}
          </div>
        )}
      </section>

      <nav className="mt-4 grid gap-2 sm:grid-cols-3" aria-label="Ad Studio links">
        <SecondaryLink href="/ad-studio/templates" icon={<LayoutTemplate aria-hidden />}>Templates</SecondaryLink>
        <SecondaryLink href="/ad-studio/library?view=assets" icon={<FolderOpen aria-hidden />}>Photos &amp; logos</SecondaryLink>
        <SecondaryLink href="/ad-studio/brand" icon={<Palette aria-hidden />}>Brand Pack</SecondaryLink>
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
  const editorHref = `/ad-studio/ads/${encodeURIComponent(ad.adId)}`;
  const reviewHref = `/ad-studio/templates/${encodeURIComponent(ad.templateId)}/publish?adId=${encodeURIComponent(ad.adId)}`;

  return (
    <article className="flex min-w-0 items-center gap-3 p-3 sm:gap-4 sm:p-4">
      <Link href={editorHref} className="size-14 shrink-0 overflow-hidden rounded-lg bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-16">
        {ad.src ? <SafeImage src={ad.src} alt={`${ad.name} preview`} compactFallback loading="lazy" decoding="async" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center"><ImageIcon className="size-4 text-muted-foreground" aria-hidden /></span>}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={editorHref} className="block truncate font-display text-[14px] font-extrabold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{ad.name}</Link>
        <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground"><Clock3 className="size-3.5 shrink-0" aria-hidden />{formatLastEdited(ad.updatedAt, timeZone, dateLocale)} · {ad.format}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button asChild variant="outline" className="min-h-11">
          <Link href={editorHref}>Edit</Link>
        </Button>
        <Button asChild className="hidden min-h-11 sm:inline-flex">
          <Link href={reviewHref}>Review</Link>
        </Button>
      </div>
    </article>
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
