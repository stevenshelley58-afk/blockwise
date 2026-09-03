"use client";

import { Clock3, Download, FilePenLine, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AD_LIBRARY_STATUS_LABEL,
  filterAndSortAds,
  type AdLibraryStatus,
} from "@/lib/adstudio/library-contract";
import type { LibraryAdModel } from "@/lib/adstudio/library-read-model";

const STATUS_ORDER: AdLibraryStatus[] = ["saved", "created_on_meta_paused", "active", "ended"];
type SortMode = "recent" | "name" | "status";

export function AdsLibrary({ ads }: { ads: LibraryAdModel[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AdLibraryStatus | "all">("all");
  const [sort, setSort] = useState<SortMode>("recent");

  const counts = useMemo(() => {
    const next = Object.fromEntries(STATUS_ORDER.map((item) => [item, 0])) as Record<AdLibraryStatus, number>;
    for (const ad of ads) next[ad.status] += 1;
    return next;
  }, [ads]);

  const visibleAds = useMemo(() => {
    return filterAndSortAds(ads, { query, status, sort });
  }, [ads, query, sort, status]);

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pb-28 pt-8 md:px-6 md:pb-16 md:pt-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[27px] font-extrabold tracking-[-.02em]">Your ads</h1>
          <p className="mt-2 max-w-[62ch] text-sm leading-6 text-muted-foreground">
            Pick up a saved ad or check what has been created on Meta.
          </p>
        </div>
        <Button asChild size="pill" className="min-h-11">
          <Link href="/ad-studio#templates"><Plus aria-hidden /> New ad</Link>
        </Button>
      </header>

      <section className="mt-8 rounded-(--r-panel) border border-(--line) bg-(--surface) p-3 shadow-card" aria-label="Ad library controls">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="relative min-w-0 flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ads" aria-label="Search ads" className="h-11 rounded-(--r-card) pl-9" />
          </label>
          <div className="flex min-w-0 flex-wrap items-center gap-1" role="group" aria-label="Filter ads by status">
            <FilterButton active={status === "all"} count={ads.length} onClick={() => setStatus("all")}>All</FilterButton>
            {STATUS_ORDER.map((item) => (
              <FilterButton key={item} active={status === item} count={counts[item]} onClick={() => setStatus(item)}>
                {AD_LIBRARY_STATUS_LABEL[item]}
              </FilterButton>
            ))}
          </div>
          <label className="flex min-h-11 shrink-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
            <span className="sr-only">Sort ads</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} aria-label="Sort ads" className="h-11 rounded-(--r-card) border border-(--line-heavy) bg-(--surface) px-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="recent">Recently edited</option>
              <option value="name">Name</option>
              <option value="status">Status</option>
            </select>
          </label>
        </div>
      </section>

      <div className="mt-5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <p aria-live="polite">{visibleAds.length} {visibleAds.length === 1 ? "ad" : "ads"}</p>
        <p className="hidden sm:block">Real saved previews · exact ad identity</p>
      </div>

      {ads.length === 0 ? (
        <EmptyAds />
      ) : visibleAds.length === 0 ? (
        <div className="mt-4 rounded-(--r-panel) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 p-10 text-center">
          <h2 className="font-display text-[17px] font-extrabold">No matching ads</h2>
          <p className="mt-1 text-sm text-muted-foreground">Try a different search or status filter.</p>
          <Button type="button" variant="outline" size="pill" className="mt-5" onClick={() => { setQuery(""); setStatus("all"); }}>Clear filters</Button>
        </div>
      ) : (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleAds.map((ad) => <AdCard key={ad.adId} ad={ad} />)}
        </ul>
      )}
    </div>
  );
}

function AdCard({ ad }: { ad: LibraryAdModel }) {
  const href = `/ad-studio/ads/${encodeURIComponent(ad.adId)}`;
  return (
    <li>
      <Card className="group relative gap-0 overflow-hidden rounded-(--r-card) border-(--line) bg-(--surface) py-0 shadow-card transition motion-reduce:transition-none hover:-translate-y-0.5 hover:shadow-float">
        <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" aria-label={`${ad.revisionId ? "Edit" : "Resume"} ${ad.name}`}>
          <div className="relative flex aspect-[4/5] items-center justify-center overflow-hidden bg-(--surface-subtle)">
            {ad.src ? <img src={ad.src} alt={`${ad.name} preview`} width={640} height={800} className="size-full object-cover" /> : <p className="px-6 text-center text-xs text-muted-foreground">Preview available after you save</p>}
            <StatusBadge status={ad.status} />
          </div>
        </Link>
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate font-display text-[15.5px] font-extrabold">{ad.name}</h2>
              <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={ad.adId}>Ad ID · {ad.adId}</p>
            </div>
            {ad.src ? <a href={ad.src} download={`${ad.name}.png`} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-(--surface-subtle) hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Download ${ad.name} preview`}><Download className="size-4" aria-hidden /></a> : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{ad.format}</span>
            <span className="inline-flex items-center gap-1"><Clock3 size={13} aria-hidden />{formatUpdatedAt(ad.updatedAt)}</span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-(--line) pt-3 text-[11px] text-muted-foreground">
            <span>Revision {ad.revisionNumber ?? "—"}</span>
            <Link href={href} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 font-semibold text-foreground hover:bg-(--surface-subtle) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><FilePenLine className="size-3.5" aria-hidden /> {ad.revisionId ? "Edit" : "Resume"}</Link>
          </div>
        </div>
      </Card>
    </li>
  );
}

function StatusBadge({ status }: { status: AdLibraryStatus }) {
  const dotClass = status === "active" ? "bg-(--ui-success)" : status === "created_on_meta_paused" ? "bg-(--ui-warning)" : "bg-(--faint)";
  return <span className="absolute left-3 top-3 inline-flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-full bg-(--surface)/95 px-2.5 py-1.5 text-[10.5px] font-bold shadow-card"><span aria-hidden className={`size-1.5 shrink-0 rounded-full ${dotClass}`} />{AD_LIBRARY_STATUS_LABEL[status]}</span>;
}

function FilterButton({ active, count, children, onClick }: { active: boolean; count: number; children: React.ReactNode; onClick: () => void }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`min-h-11 rounded-full px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-(--surface-subtle)"}`}>{children}<span className={active ? "ml-1 opacity-70" : "ml-1 text-muted-foreground"}>{count}</span></button>;
}

function EmptyAds() {
  return <div className="mt-4 rounded-(--r-panel) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 p-10 text-center"><h2 className="font-display text-[17px] font-extrabold">No saved ads yet</h2><p className="mx-auto mt-1 max-w-[42ch] text-sm text-muted-foreground">Choose a template to create your first ad. It will appear here after you save it.</p><Button asChild size="pill" className="mt-5"><Link href="/ad-studio#templates">Choose a template <Plus aria-hidden /></Link></Button></div>;
}

function formatUpdatedAt(value: string | null): string { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? `Edited ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)}` : "Recently edited"; }
