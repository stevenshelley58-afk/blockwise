import Link from "next/link";
import { Button } from "@/components/ui/button";
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
        <h2 id="template-review-heading" className="font-display text-[20px] font-extrabold tracking-[-.02em]">No reviewed templates available</h2>
        <p className="mx-auto mt-2 max-w-[48ch] text-sm leading-6 text-muted-foreground">New ads start only from a reviewed Feed and Story design. Finish your Brand Pack or return to Ad Studio while reviewed templates are unavailable.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button asChild><Link href="/ad-studio/brand">Review Brand Pack</Link></Button>
          <Button asChild variant="outline"><Link href="/ad-studio">Return to Ad Studio</Link></Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Templates">
      {templates.length > 0 ? <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{templates.map((template) => <TemplateCard key={template.templateId} template={template} createAction={createAction} />)}</ul> : hasActiveFilter ? <div className="rounded-(--r-panel) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 p-10 text-center"><h3 className="font-display text-[17px] font-extrabold">No templates match{query ? ` “${query}”` : " this lead type"}</h3><p className="mx-auto mt-2 max-w-[44ch] text-sm leading-6 text-muted-foreground">Try another search or lead type.</p><Button asChild variant="outline" className="mt-5"><Link href="/ad-studio/templates">Clear filters</Link></Button></div> : <div className="rounded-(--r-panel) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 p-10 text-center"><h3 className="font-display text-[17px] font-extrabold">New templates are being prepared</h3><p className="mx-auto mt-2 max-w-[44ch] text-sm leading-6 text-muted-foreground">Reviewed Feed and Story templates will appear here as soon as they are ready to use.</p></div>}
    </section>
  );
}

function TemplateCard({ template, createAction }: { template: TemplateSummary; createAction: (formData: FormData) => void | Promise<void> }) {
  return <li className="min-w-0"><article className="overflow-hidden rounded-(--r-card) border border-border bg-card shadow-card transition hover:-translate-y-0.5 hover:shadow-float motion-reduce:transform-none"><Link href={`/ad-studio/templates/${encodeURIComponent(template.templateId)}`} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"><img src={`${template.gallerySampleUrl}&w=640`} alt={`${template.name} template preview`} width={640} height={800} loading="lazy" decoding="async" className="aspect-[4/5] w-full object-cover" /></Link><div className="grid grid-cols-2 gap-2 p-3"><form action={createAction} className="min-w-0"><input type="hidden" name="creationKey" value={crypto.randomUUID()} /><input type="hidden" name="templateId" value={template.templateId} /><Button type="submit" size="pill" className="w-full">Use template</Button></form><Button asChild variant="outline" size="pill" className="min-w-0"><Link href={`/ad-studio/templates/${encodeURIComponent(template.templateId)}`} aria-label={`Preview ${template.name}`}>Preview template</Link></Button></div></article></li>;
}
