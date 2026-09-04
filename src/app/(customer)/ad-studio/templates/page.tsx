import { ArrowLeft, Search } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { TemplateGallery } from "@/components/adstudio/template-gallery";
import { getTemplate, listTemplates } from "@/lib/adstudio/pack-gallery";
import { createCustomerAd } from "@/lib/adstudio/create-customer-ad";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ q?: string; filter?: string }>;

export default async function TemplatesPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase } = await requirePageSurfaceAccess("adstudio");
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const filter = params.filter === "image" || params.filter === "copy" ? params.filter : "all";
  let templates;
  try {
    templates = await listTemplates(supabase);
  } catch {
    return <TemplateReadError />;
  }
  const normalized = query.toLocaleLowerCase();
  const filtered = templates.filter((template) => {
    const searchable = `${template.name} ${template.description}`.toLocaleLowerCase();
    const matchesQuery = !normalized || searchable.includes(normalized);
    const matchesFilter = filter === "all" || (filter === "image" ? template.imageInputs > 0 : template.textInputs > 0);
    return matchesQuery && matchesFilter;
  });
  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16">
      <Link href="/ad-studio" className="inline-flex min-h-11 items-center gap-2 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="size-4" aria-hidden />Ad Studio home</Link>
      <header className="mt-5 max-w-[700px]"><h1 className="font-display text-[clamp(26px,4vw,34px)] font-extrabold tracking-[-.025em]">Choose a template</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Compare the finished Feed and Story designs, then open the one that fits your ad.</p></header>
      {templates.length > 0 ? <form action="/ad-studio/templates" method="get" role="search" className="mt-7 rounded-(--r-panel) border border-border bg-card p-4 shadow-card md:p-5"><div className="flex min-h-11 items-center gap-3 rounded-(--r-card) border border-input bg-background px-3 focus-within:border-(--ink) focus-within:ring-2 focus-within:ring-(--ink)/10"><Search className="size-4 shrink-0 text-muted-foreground" aria-hidden /><label htmlFor="template-search" className="sr-only">Search templates</label><input id="template-search" name="q" defaultValue={query} placeholder="Search templates by name or goal…" className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none placeholder:text-muted-foreground/75" />{filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}<button type="submit" className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-primary px-4 text-[12.5px] font-bold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Search</button></div><div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Template filters"><FilterLink href={filterHref(query, "all")} label="All templates" active={filter === "all"} /><FilterLink href={filterHref(query, "image")} label="Uses image inputs" active={filter === "image"} /><FilterLink href={filterHref(query, "copy")} label="Uses text inputs" active={filter === "copy"} /></div></form> : null}
      <div className="mt-8"><TemplateGallery templates={filtered} query={query} filter={filter} createAction={createAdAction} hasAvailableTemplates={templates.length > 0} /></div>
      {templates.length > 0 ? <p className="mt-8 text-center text-xs text-muted-foreground">All {templates.length} reviewed templates remain available here. Details reflect the imported template.</p> : null}
    </div>
  );
}

function filterHref(query: string, filter: string) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (filter !== "all") params.set("filter", filter);
  const value = params.toString();
  return value ? `/ad-studio/templates?${value}` : "/ad-studio/templates";
}

function FilterLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return <Link href={href} aria-current={active ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-full border px-3.5 text-[12px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted"}`}>{label}</Link>;
}

function TemplateReadError() {
  return <div className="mx-auto w-full max-w-[720px] px-4 pt-8 pb-28 md:px-6 md:pt-12 md:pb-16"><Link href="/ad-studio" className="inline-flex min-h-11 items-center gap-2 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden />Ad Studio home</Link><div className="mt-6 rounded-(--r-panel) border border-(--ui-error)/25 bg-(--ui-error-soft) p-6"><h1 className="font-display text-[20px] font-extrabold">Templates are temporarily unavailable.</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Refresh to try again. Your saved ads and workspace remain available.</p></div></div>;
}

async function createAdAction(formData: FormData) {
  "use server";
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const creationKey = String(formData.get("creationKey") ?? "").trim();
  const templateId = String(formData.get("templateId") ?? "").trim();
  if (!/^[a-z0-9-]{20,80}$/i.test(creationKey)) throw new Error("Invalid creation request.");
  if (!templateId) notFound();
  const pack = await getTemplate(supabase, templateId);
  if (!pack) notFound();
  const ad = await createCustomerAd(supabase, access.workspaceId, pack, creationKey);
  redirect(`/ad-studio/ads/${encodeURIComponent(ad.adId)}`);
}
