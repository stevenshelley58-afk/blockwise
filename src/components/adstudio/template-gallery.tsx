import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { TemplateLeadType, TemplateSummary } from "@/lib/adstudio/pack-gallery";

type TemplateGalleryProps = {
  templates: TemplateSummary[];
  query: string;
  lead: TemplateLeadType | "all";
  hasAvailableTemplates: boolean;
  createAction: (formData: FormData) => void | Promise<void>;
};

export function TemplateGallery({ templates, query, lead, hasAvailableTemplates, createAction }: TemplateGalleryProps) {
  const hasActiveFilter = Boolean(query) || lead !== "all";

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
    <section aria-label="Templates">
      {templates.length > 0 ? <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{templates.map((template) => <TemplateCard key={template.templateId} template={template} createAction={createAction} />)}</ul> : hasActiveFilter ? <div className="rounded-(--r-panel) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 p-10 text-center"><h3 className="font-display text-[17px] font-extrabold">No templates match{query ? ` “${query}”` : " this lead type"}</h3><p className="mx-auto mt-2 max-w-[44ch] text-sm leading-6 text-muted-foreground">Try another search or lead type.</p><Link href="/ad-studio/templates" className="mt-5 inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 text-[12.5px] font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Clear filters</Link></div> : <div className="rounded-(--r-panel) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 p-10 text-center"><h3 className="font-display text-[17px] font-extrabold">New templates are being prepared</h3><p className="mx-auto mt-2 max-w-[44ch] text-sm leading-6 text-muted-foreground">Reviewed Feed and Story templates will appear here as soon as they are ready to use.</p></div>}
    </section>
  );
}

function TemplateCard({ template, createAction }: { template: TemplateSummary; createAction: (formData: FormData) => void | Promise<void> }) {
  return <li className="min-w-0"><article className="overflow-hidden rounded-(--r-card) border border-border bg-card shadow-card transition hover:-translate-y-0.5 hover:shadow-float motion-reduce:transform-none"><Link href={`/ad-studio/templates/${encodeURIComponent(template.templateId)}`} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"><img src={template.gallerySampleUrl} alt={`${template.name} template preview`} className="aspect-[4/5] w-full object-cover" /></Link><div className="grid grid-cols-2 gap-2 p-3"><form action={createAction} className="min-w-0"><input type="hidden" name="creationKey" value={crypto.randomUUID()} /><input type="hidden" name="templateId" value={template.templateId} /><button type="submit" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-3 text-[12.5px] font-bold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Use template <ArrowRight className="size-4" aria-hidden /></button></form><Link href={`/ad-studio/templates/${encodeURIComponent(template.templateId)}`} aria-label={`Preview ${template.name}`} className="inline-flex min-h-11 min-w-0 items-center justify-center rounded-full border border-border px-3 text-center text-[12.5px] font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Preview template</Link></div></article></li>;
}
