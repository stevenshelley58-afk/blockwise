import { ArrowLeft, Check, FileText, Image as ImageIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { createCustomerAd } from "@/lib/adstudio/create-customer-ad";
import { getTemplate } from "@/lib/adstudio/pack-gallery";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function TemplateDetailPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const { supabase } = await requirePageSurfaceAccess("adstudio");
  const pack = await getTemplate(supabase, templateId);
  if (!pack) notFound();
  const title = pack.metadata.title?.trim() || pack.templateId;
  const description = pack.metadata.description?.trim() || "Editable Feed and Story ad";
  const creationKey = crypto.randomUUID();
  const requiredImages = pack.imageInputs.filter((input) => input.required !== false);
  const requiredText = pack.textInputs;
  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16">
      <Link href="/ad-studio/templates" className="inline-flex min-h-11 items-center gap-2 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="size-4" aria-hidden />All templates</Link>
      <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <section aria-labelledby="template-title">
          <header className="max-w-[680px]"><p className="font-mono text-[9.5px] uppercase tracking-[.12em] text-muted-foreground">Template preview</p><h1 id="template-title" className="mt-2 font-display text-[clamp(24px,4vw,32px)] font-extrabold tracking-[-.025em]">{title}</h1><p className="mt-2 max-w-[60ch] text-sm leading-6 text-muted-foreground">{description}</p></header>
          <div className="mt-7 grid gap-4 sm:grid-cols-[minmax(0,1.05fr)_minmax(150px,.6fr)] sm:items-start">
            <PreviewPanel label="Feed" detail="4:5 placement" src={`/api/adstudio/templates/${encodeURIComponent(templateId)}/sample?placement=feed`} className="aspect-[4/5]" />
            <PreviewPanel label="Story" detail="9:16 placement" src={`/api/adstudio/templates/${encodeURIComponent(templateId)}/sample?placement=story`} className="aspect-[9/16]" />
          </div>
          <div className="mt-5 rounded-(--r-card) border border-border bg-card p-4"><p className="font-mono text-[9.5px] uppercase tracking-[.12em] text-muted-foreground">Imported metadata</p><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span>{formatImportedAt(pack.createdAt)}</span><span>Feed + Story included</span><span>{pack.feedLayout.layers.length + pack.storyLayout.layers.length} layout layers</span></div></div>
        </section>
        <aside className="lg:sticky lg:top-6"><section className="rounded-(--r-panel) border border-border bg-card p-5 shadow-card" aria-labelledby="inputs-heading"><p className="font-mono text-[9.5px] uppercase tracking-[.12em] text-muted-foreground">Before you start</p><h2 id="inputs-heading" className="mt-1 font-display text-[17px] font-extrabold">What you will need</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">These are the inputs this imported pack expects. You can adjust them in the editor.</p><div className="mt-5 space-y-4">{requiredImages.length > 0 ? <InputGroup title="Image inputs" icon={<ImageIcon className="size-4" aria-hidden />} items={requiredImages.map((input) => input.label)} /> : null}{requiredText.length > 0 ? <InputGroup title="Text inputs" icon={<FileText className="size-4" aria-hidden />} items={requiredText.map((input) => input.label)} /> : null}{requiredImages.length === 0 && requiredText.length === 0 ? <div className="rounded-(--r-card) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 p-4 text-sm text-muted-foreground">No additional inputs are required. You can start with the imported defaults.</div> : null}</div><form action={createAdAction.bind(null, creationKey)} className="mt-6"><input type="hidden" name="templateId" value={templateId} /><button type="submit" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-[12.5px] font-bold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Use this template</button></form><p className="mt-3 text-center text-xs text-muted-foreground">Creates a new editable ad in your workspace.</p></section></aside>
      </div>
    </div>
  );
}

function PreviewPanel({ label, detail, src, className }: { label: string; detail: string; src: string; className: string }) {
  return <figure className="min-w-0"><div className={`relative overflow-hidden rounded-(--r-panel) border border-border bg-(--surface-subtle) shadow-card ${className}`}><img src={src} alt={`${label} preview for this template`} className="h-full w-full object-cover" /></div><figcaption className="mt-2 flex items-center justify-between gap-2"><span className="font-display text-[14px] font-extrabold">{label}</span><span className="text-xs text-muted-foreground">{detail}</span></figcaption></figure>;
}

function InputGroup({ title, icon, items }: { title: string; icon: ReactNode; items: string[] }) {
  return <div><h3 className="flex items-center gap-2 text-[12.5px] font-bold">{icon}{title}</h3><ul className="mt-2 space-y-2">{items.map((item) => <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground"><Check className="mt-0.5 size-4 shrink-0 text-(--ui-success)" aria-hidden /><span className="min-w-0 break-words">{item}</span></li>)}</ul></div>;
}

function formatImportedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Imported pack" : `Imported ${new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date)}`;
}

async function createAdAction(creationKey: string, formData: FormData) {
  "use server";
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const templateId = String(formData.get("templateId") ?? "").trim();
  if (!/^[a-z0-9-]{20,80}$/i.test(creationKey)) throw new Error("Invalid creation request.");
  if (!templateId) notFound();
  const pack = await getTemplate(supabase, templateId);
  if (!pack) notFound();
  const ad = await createCustomerAd(supabase, access.workspaceId, pack, creationKey);
  redirect(`/ad-studio/ads/${encodeURIComponent(ad.adId)}`);
}
