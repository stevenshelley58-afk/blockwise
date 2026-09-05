import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SearchField, SearchFilterPanel, SearchFilterRow, filterChipClassName } from "@/components/adstudio/search-filter-controls";
import { TemplateGallery } from "@/components/adstudio/template-gallery";
import { getTemplate, listTemplates, type TemplateLeadType } from "@/lib/adstudio/pack-gallery";
import { createCustomerAd } from "@/lib/adstudio/create-customer-ad";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ q?: string; lead?: string }>;

const LEAD_FILTERS: ReadonlyArray<{ value: TemplateLeadType | "all"; label: string }> = [
  { value: "all", label: "All leads" },
  { value: "seller", label: "Seller leads" },
  { value: "buyer", label: "Buyer leads" },
  { value: "appraisal", label: "Appraisal leads" },
  { value: "open_home", label: "Open home leads" },
  { value: "market_update", label: "Market update leads" },
];

export default async function TemplatesPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase } = await requirePageSurfaceAccess("adstudio");
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const lead = LEAD_FILTERS.some((item) => item.value !== "all" && item.value === params.lead)
    ? params.lead as TemplateLeadType
    : "all";
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
    const matchesLead = lead === "all" || template.leadType === lead;
    return matchesQuery && matchesLead;
  });
  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16">
      <Link href="/ad-studio" className="inline-flex min-h-11 items-center gap-2 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="size-4" aria-hidden />Ad Studio home</Link>
      <header className="mt-5 max-w-[700px]"><h1 className="font-display text-[clamp(26px,4vw,34px)] font-extrabold tracking-[-.025em]">Choose a template</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Compare the finished Feed and Story designs, then open the one that fits your ad.</p></header>
      {templates.length > 0 ? <form action="/ad-studio/templates" method="get" role="search" className="mt-7"><SearchFilterPanel label="Template search and filters"><SearchField id="template-search" name="q" type="search" defaultValue={query} label="Search templates" placeholder="Search templates by name or goal…" action={<button type="submit" className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-primary px-4 text-[12.5px] font-bold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Search</button>} />{lead !== "all" ? <input type="hidden" name="lead" value={lead} /> : null}<SearchFilterRow>{LEAD_FILTERS.map((item) => <FilterLink key={item.value} href={filterHref(query, item.value)} label={item.label} active={lead === item.value} />)}</SearchFilterRow></SearchFilterPanel></form> : null}
      <div className="mt-6"><TemplateGallery templates={filtered} query={query} lead={lead} createAction={createAdAction} hasAvailableTemplates={templates.length > 0} /></div>
    </div>
  );
}

function filterHref(query: string, lead: TemplateLeadType | "all") {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (lead !== "all") params.set("lead", lead);
  const value = params.toString();
  return value ? `/ad-studio/templates?${value}` : "/ad-studio/templates";
}

function FilterLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return <Link href={href} aria-current={active ? "page" : undefined} className={filterChipClassName(active)}>{label}</Link>;
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
