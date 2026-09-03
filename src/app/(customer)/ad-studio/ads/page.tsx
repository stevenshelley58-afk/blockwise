import { ArrowRight, Clock3, Plus } from "lucide-react";
import Link from "next/link";
import { loadAdStudioLibraryPage, type LibraryAdModel } from "@/lib/adstudio/library-read-model";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function AdsCollectionPage() {
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  let result: Awaited<ReturnType<typeof loadAdStudioLibraryPage>> | null = null;
  let failed = false;
  try {
    result = await loadAdStudioLibraryPage({ supabase, workspaceId: access.workspaceId, kind: "ads", limit: 50 });
  } catch { failed = true; }
  const ads = (result?.items ?? []) as LibraryAdModel[];
  return <div className="mx-auto w-full max-w-[1120px] px-4 pb-10 pt-8 md:px-8 md:pb-16 md:pt-10">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="font-display text-[27px] font-extrabold tracking-[-.02em]">Your ads</h1><p className="mt-2 max-w-[62ch] text-sm leading-6 text-muted-foreground">Saved creatives stay here while you review and refine them.</p></div><Link href="/ad-studio#templates" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Plus size={16} aria-hidden />New ad</Link></div>
    {failed ? <div role="alert" className="mt-8 rounded-(--r-card) border border-(--ui-error)/25 bg-(--ui-error-soft) p-5 text-sm"><p className="font-semibold text-(--ui-error)">Couldn’t load saved ads.</p><p className="mt-1 text-muted-foreground">Refresh the page to try again.</p></div> : ads.length === 0 ? <div className="mt-8 rounded-(--r-panel) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 p-10 text-center"><h2 className="font-display text-[17px] font-extrabold">No saved ads yet</h2><p className="mx-auto mt-1 max-w-[42ch] text-sm text-muted-foreground">Choose a template to create your first ad. It will appear here after creation.</p><Link href="/ad-studio#templates" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground">Choose a template <ArrowRight size={15} aria-hidden /></Link></div> : <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{ads.map((ad) => <li key={ad.adId}><Link href={`/ad-studio/ads/${encodeURIComponent(ad.adId)}`} className="group block overflow-hidden rounded-(--r-card) border border-border bg-card shadow-card transition hover:-translate-y-0.5 hover:shadow-float focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none"><div className="flex aspect-[4/5] items-center justify-center bg-muted">{ad.src ? <img src={ad.src} alt={`${ad.name} preview`} className="h-full w-full object-cover" /> : <span className="px-6 text-center text-xs text-muted-foreground">Preview available after you save</span>}</div><div className="p-4"><div className="flex items-center justify-between gap-3"><h2 className="min-w-0 truncate font-display text-[15.5px] font-extrabold">{ad.name}</h2><span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[10.5px] font-bold">Saved</span></div><div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{ad.format}</span>{ad.updatedAt ? <span className="inline-flex items-center gap-1"><Clock3 size={13} aria-hidden />{formatUpdatedAt(ad.updatedAt)}</span> : null}</div></div></Link></li>)}</ul>}
  </div>;
}

function formatUpdatedAt(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Recently updated" : `Updated ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)}`; }
