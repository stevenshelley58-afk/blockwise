import { ArrowRight, FileText, Image as ImageIcon, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import type { TemplateSummary } from "@/lib/adstudio/pack-gallery";

type TemplateGalleryProps = {
  templates: TemplateSummary[];
  query: string;
  filter: string;
  hasAvailableTemplates: boolean;
  createAction: (formData: FormData) => void | Promise<void>;
};

export function TemplateGallery({ templates, query, filter, hasAvailableTemplates, createAction }: TemplateGalleryProps) {
  const hasActiveFilter = Boolean(query) || filter !== "all";

  if (!hasAvailableTemplates) {
    return (
      <section aria-labelledby="template-review-heading" className="rounded-(--r-panel) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 px-6 py-12 text-center sm:py-16">
        <h2 id="template-review-heading" className="font-display text-[20px] font-extrabold tracking-[-.02em]">Templates are in final review</h2>
        <p className="mx-auto mt-2 max-w-[48ch] text-sm leading-6 text-muted-foreground">New ads start only from a reviewed Feed + Story design. Your saved ads remain available while the next template is being checked.</p>
        <Link href="/ad-studio/library?view=ads" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-card px-4 text-[12.5px] font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Open saved ads</Link>
      </section>
    );
  }

  return (
    <section aria-labelledby="template-results-heading">
      <div className="flex items-center justify-between gap-4">
        <div><p className="font-mono text-[9.5px] uppercase tracking-[.12em] text-muted-foreground">Results</p><h2 id="template-results-heading" className="mt-1 font-display text-[17px] font-extrabold">{templates.length} {templates.length === 1 ? "template" : "templates"}</h2></div>
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex"><SlidersHorizontal className="size-3.5" aria-hidden /> {hasActiveFilter ? "Filtered to your brief" : "Showing all available templates"}</span>
      </div>
      {templates.length > 0 ? <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{templates.map((template) => <TemplateCard key={template.templateId} template={template} createAction={createAction} />)}</ul> : hasActiveFilter ? <div className="mt-4 rounded-(--r-panel) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 p-10 text-center"><h3 className="font-display text-[17px] font-extrabold">No templates match{query ? ` “${query}”` : " this filter"}</h3><p className="mx-auto mt-2 max-w-[44ch] text-sm leading-6 text-muted-foreground">Try a broader phrase or clear the filter. All available templates will stay in this gallery.</p><Link href="/ad-studio/templates" className="mt-5 inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 text-[12.5px] font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Clear search</Link></div> : <div className="mt-4 rounded-(--r-panel) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 p-10 text-center"><h3 className="font-display text-[17px] font-extrabold">New templates are being prepared</h3><p className="mx-auto mt-2 max-w-[44ch] text-sm leading-6 text-muted-foreground">Reviewed Feed and Story templates will appear here as soon as they are ready to use.</p></div>}
    </section>
  );
}

function TemplateCard({ template, createAction }: { template: TemplateSummary; createAction: (formData: FormData) => void | Promise<void> }) {
  const imageCount = template.imageInputs;
  const textCount = template.textInputs;
  return <li className="min-w-0"><article className="flex h-full flex-col overflow-hidden rounded-(--r-card) border border-border bg-card shadow-card transition hover:-translate-y-0.5 hover:shadow-float motion-reduce:transform-none"><Link href={`/ad-studio/templates/${encodeURIComponent(template.templateId)}`} className="group relative block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"><img src={template.gallerySampleUrl} alt={`${template.name} Feed preview`} className="aspect-[4/5] w-full object-cover" /><span className="absolute bottom-3 left-3 rounded-full bg-(--ink)/85 px-2.5 py-1 text-[10.5px] font-bold text-white">Preview Feed + Story</span></Link><div className="flex flex-1 flex-col p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate font-display text-[15.5px] font-extrabold">{template.name}</h3><p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">{template.description}</p></div><span className="shrink-0 rounded-full border border-border px-2 py-1 font-mono text-[9.5px] uppercase tracking-[.08em] text-muted-foreground">Reviewed</span></div><div className="mt-4 grid grid-cols-2 gap-2 border-y border-border py-3 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><ImageIcon className="size-3.5" aria-hidden />{imageCount} image {imageCount === 1 ? "input" : "inputs"}</span><span className="flex items-center gap-1.5"><FileText className="size-3.5" aria-hidden />{textCount} text {textCount === 1 ? "input" : "inputs"}</span></div><div className="mt-auto flex flex-wrap gap-2 pt-4"><form action={createAction}><input type="hidden" name="creationKey" value={crypto.randomUUID()} /><input type="hidden" name="templateId" value={template.templateId} /><button type="submit" className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-3 text-[12.5px] font-bold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Use template <ArrowRight className="size-4" aria-hidden /></button></form><Link href={`/ad-studio/templates/${encodeURIComponent(template.templateId)}`} aria-label={`Preview ${template.name}`} className="inline-flex min-h-11 items-center justify-center rounded-full border border-border px-3 text-[12.5px] font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Preview</Link></div></div></article></li>;
}
