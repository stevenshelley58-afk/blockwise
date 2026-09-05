"use client";

import { useState, type ReactNode } from "react";
import type { AdTemplate } from "../../../packages/ad-template-contract/src/types";
import { LayeredCanvas } from "./editor/layered-canvas";
import { FeedPreview, StoryPreview } from "./editor/meta-previews";
import { templateAssetProxyUrl } from "@/lib/adstudio/pack-gallery";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function TemplateDetailPreview({ template }: { template: AdTemplate }) {
  const [mode, setMode] = useState<"meta" | "artwork">("meta");
  const textValues = Object.fromEntries(template.textInputs.map((input) => [input.key, input.placeholder]));
  const imageValues = Object.fromEntries(template.imageInputs.flatMap((input) => input.defaultAssetKey
    ? [[input.key, templateAssetProxyUrl(template.templateId, input.defaultAssetKey)]]
    : []));
  const copy = {
    primaryText: template.metadata.metaCopyDefaults.primaryText[0] ?? "",
    headline: template.metadata.metaCopyDefaults.headlines[0] ?? "",
    description: template.metadata.metaCopyDefaults.descriptions[0] ?? "",
    cta: template.metadata.metaCopyDefaults.cta,
  };
  const common = { templateId: template.templateId, existingAdId: "", assets: template.assets, colours: template.semanticColours, textValues, imageValues, copy, businessName: "Your business", logoUrl: null, destinationUrl: "https://your-business.example" } as const;
  return (
    <section className="mt-7" aria-label="Template preview">
      <Tabs value={mode} onValueChange={(value) => setMode(value as "meta" | "artwork")}>
        <TabsList aria-label="Preview type" className="h-auto rounded-full bg-muted/60 p-1">
          <TabsTrigger value="meta" className="min-h-11 rounded-full px-5">Meta ad</TabsTrigger>
          <TabsTrigger value="artwork" className="min-h-11 rounded-full px-5">Artwork</TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="mt-3 text-sm text-muted-foreground">{mode === "meta" ? "Preview the complete ad people will see on Meta." : "Inspect only the editable artwork sent to Meta."}</p>
      <div className="mt-5 grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(200px,.72fr)] sm:items-start">
        <PreviewFrame label="Feed" detail="4:5 placement">
          {mode === "meta" ? <FeedPreview {...common} layout={template.feedLayout} /> : <div className="aspect-[4/5]"><LayeredCanvas {...common} layout={template.feedLayout} /></div>}
        </PreviewFrame>
        <PreviewFrame label="Story" detail="9:16 placement">
          {mode === "meta" ? <StoryPreview {...common} layout={template.storyLayout} /> : <div className="aspect-[9/16]"><LayeredCanvas {...common} layout={template.storyLayout} /></div>}
        </PreviewFrame>
      </div>
    </section>
  );
}

function PreviewFrame({ label, detail, children }: { label: string; detail: string; children: ReactNode }) {
  return <figure className="min-w-0"><div className="flex justify-center overflow-hidden rounded-(--r-panel) border border-border bg-(--surface-subtle) p-3 shadow-card">{children}</div><figcaption className="mt-2 flex items-center justify-between gap-2"><span className="font-display text-[14px] font-extrabold">{label}</span><span className="text-xs text-muted-foreground">{detail}</span></figcaption></figure>;
}
