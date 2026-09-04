import { ArrowRight, Clock3, FolderOpen, Image as ImageIcon, LayoutGrid, Palette, Plus, Search } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { LibraryAdModel, LibraryAssetModel } from "@/lib/adstudio/library-read-model";

type HomeCommandProps = {
  ads: LibraryAdModel[];
  assets: LibraryAssetModel[];
  adsError: boolean;
  assetsError: boolean;
  timeZone: string;
  dateLocale: "en-AU" | "en-US";
};

/** The arrival surface: one command, then the work already in motion. */
export function HomeCommand({ ads, assets, adsError, assetsError, timeZone, dateLocale }: HomeCommandProps) {
  return (
    <div>
      <header className="max-w-[720px]">
        <h1 className="font-display text-[clamp(26px,4vw,34px)] font-extrabold tracking-[-.025em]">Create your next ad</h1>
        <p className="mt-2 max-w-[60ch] text-sm leading-6 text-muted-foreground">Choose a reviewed design, add your images and copy, then finish Feed and Story in the editor.</p>
      </header>

      <Link href="/ad-studio/templates" aria-label="Create a new ad from a reviewed template" className="group mt-6 flex min-h-[124px] max-w-[760px] flex-col justify-between gap-5 rounded-(--r-panel) bg-primary p-5 text-primary-foreground shadow-card transition duration-200 ease-spring hover:-translate-y-0.5 hover:shadow-float focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transform-none sm:flex-row sm:items-center sm:p-6">
        <span className="flex min-w-0 items-center gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-white/10" aria-hidden><Plus className="size-5" /></span>
          <span className="min-w-0">
            <span className="block font-display text-[20px] font-extrabold tracking-[-.02em]">Create a new ad</span>
            <span className="mt-1 block text-sm leading-6 text-white/70">Start with a reviewed Feed + Story template.</span>
          </span>
        </span>
        <span className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-full bg-white px-5 text-[12.5px] font-bold text-primary sm:w-auto">Create ad <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden /></span>
      </Link>

      <form action="/ad-studio/templates" method="get" role="search" className="mt-4 max-w-[760px]">
        <label htmlFor="studio-command" className="sr-only">Search templates or describe what you need</label>
        <div className="flex min-h-12 items-center gap-3 rounded-(--r-card) border border-(--line-heavy) bg-card px-4 transition focus-within:border-(--ink) focus-within:ring-2 focus-within:ring-(--ink)/10">
          <Search className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
          <input id="studio-command" name="q" type="search" placeholder="Or search templates by goal or format…" className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground/75" />
          <button type="submit" className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-[12.5px] font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Search</button>
        </div>
      </form>

      <section className="mt-8" aria-labelledby="workspace-shortcuts-heading">
        <div className="flex items-center justify-between gap-4"><h2 id="workspace-shortcuts-heading" className="font-display text-[15.5px] font-extrabold">Workspace shortcuts</h2><span className="font-mono text-[9.5px] uppercase tracking-[.12em] text-muted-foreground">Your workspace</span></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Shortcut href="/ad-studio/library?view=ads" icon={<LayoutGrid aria-hidden />} label="Saved ads" detail="Review and continue" />
          <Shortcut href="/ad-studio/library?view=assets" icon={<FolderOpen aria-hidden />} label="Media library" detail={assetsError ? "Temporarily unavailable" : `${assets.length} recent assets`} />
          <Shortcut href="/ad-studio/brand" icon={<Palette aria-hidden />} label="Brand Pack" detail="Keep your look consistent" />
        </div>
      </section>

      <section className="mt-9" aria-labelledby="recent-work-heading">
        <div className="flex items-end justify-between gap-4"><div><p className="font-mono text-[9.5px] uppercase tracking-[.12em] text-muted-foreground">Recent work</p><h2 id="recent-work-heading" className="mt-1 font-display text-[17px] font-extrabold">Pick up where you left off</h2></div><Link href="/ad-studio/library?view=ads" className="inline-flex min-h-11 items-center gap-1 text-[12px] font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View all <ArrowRight size={15} aria-hidden /></Link></div>
        {adsError ? <ReadError label="recent work" /> : ads.length > 0 ? <div className="mt-4 divide-y divide-border overflow-hidden rounded-(--r-card) border border-border bg-card">{ads.slice(0, 3).map((ad) => <RecentAd key={ad.adId} ad={ad} timeZone={timeZone} dateLocale={dateLocale} />)}</div> : <div className="mt-4 rounded-(--r-card) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 p-6 text-center"><h3 className="font-display text-[15.5px] font-extrabold">No saved ads yet</h3><p className="mx-auto mt-1 max-w-[42ch] text-sm text-muted-foreground">Search for a template above to create your first ad. Your progress will appear here.</p></div>}
      </section>

      {!assetsError && assets.length > 0 ? <section className="mt-9" aria-labelledby="recent-assets-heading"><div className="flex items-end justify-between gap-4"><div><p className="font-mono text-[9.5px] uppercase tracking-[.12em] text-muted-foreground">Media</p><h2 id="recent-assets-heading" className="mt-1 font-display text-[17px] font-extrabold">Recent assets</h2></div><Link href="/ad-studio/library?view=assets" className="inline-flex min-h-11 items-center gap-1 text-[12px] font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View library <ArrowRight size={15} aria-hidden /></Link></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">{assets.map((asset) => <Link key={asset.id} href="/ad-studio/library?view=assets" className="group overflow-hidden rounded-(--r-card) border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><img src={asset.src} alt={asset.label} className="aspect-square w-full object-cover transition group-hover:scale-[1.02] motion-reduce:transform-none" /><span className="block truncate px-3 py-2 text-[11px] font-semibold">{asset.label}</span></Link>)}</div></section> : null}
    </div>
  );
}

function Shortcut({ href, icon, label, detail }: { href: string; icon: ReactNode; label: string; detail: string }) {
  return <Link href={href} className="group flex min-h-[76px] items-center gap-3 rounded-(--r-card) border border-border bg-card p-4 transition hover:border-(--line-heavy) hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-foreground [&>svg]:size-[18px]" aria-hidden>{icon}</span><span className="min-w-0 flex-1"><span className="block font-display text-[14px] font-extrabold">{label}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{detail}</span></span><ArrowRight className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" aria-hidden /></Link>;
}

function RecentAd({ ad, timeZone, dateLocale }: { ad: LibraryAdModel; timeZone: string; dateLocale: "en-AU" | "en-US" }) {
  return <article className="flex min-w-0 items-center gap-3 p-3 sm:gap-4 sm:p-4"><Link href={`/ad-studio/ads/${encodeURIComponent(ad.adId)}`} className="size-14 shrink-0 overflow-hidden rounded-lg bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-16">{ad.src ? <img src={ad.src} alt={`${ad.name} preview`} className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center"><ImageIcon className="size-4 text-muted-foreground" aria-hidden /></span>}</Link><div className="min-w-0 flex-1"><Link href={`/ad-studio/ads/${encodeURIComponent(ad.adId)}`} className="block truncate font-display text-[14px] font-extrabold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{ad.name}</Link><p className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground"><Clock3 className="size-3.5 shrink-0" aria-hidden />{formatLastEdited(ad.updatedAt, timeZone, dateLocale)} · {ad.format}</p></div><div className="flex shrink-0 items-center gap-2"><Link href={`/ad-studio/ads/${encodeURIComponent(ad.adId)}`} className="inline-flex min-h-11 items-center rounded-full border border-border px-3 text-[12px] font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Edit</Link><Link href={`/ad-studio/templates/${encodeURIComponent(ad.templateId)}/publish?adId=${encodeURIComponent(ad.adId)}`} className="hidden min-h-11 items-center rounded-full bg-primary px-3 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex">Review</Link></div></article>;
}

function ReadError({ label }: { label: string }) {
  return <div className="mt-4 rounded-(--r-card) border border-(--ui-error)/25 bg-(--ui-error-soft) p-5 text-sm"><p className="font-semibold text-(--ui-error)">Couldn’t load {label}.</p><p className="mt-1 text-muted-foreground">Refresh to try again. Other Studio sections are still available.</p></div>;
}

function formatLastEdited(value: string | null, timeZone: string, locale: "en-AU" | "en-US"): string {
  if (!value) return "recently";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(date);
}
