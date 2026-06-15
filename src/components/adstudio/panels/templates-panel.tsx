"use client";

import { useMemo } from "react";
import { Plus } from "lucide-react";

import type { AdStudioBrandKit, AdStudioTemplate } from "@/lib/adstudio";
import { templatePreviewDataUrl } from "@/lib/adstudio/template-preview.ts";

import { PanelHeader } from "../inspector";

type TemplateCardProps = {
  template: AdStudioTemplate;
  brandKit: AdStudioBrandKit;
  active?: boolean;
  onSelect: (id: string) => void;
};

export function TemplateCard({ template, brandKit, active, onSelect }: TemplateCardProps) {
  // A branded preview of this template's actual layout (the customer's colours,
  // fonts and logo around a "your photo here" placeholder). It shows what their
  // ad will look like once they add their listing photo — a true range of
  // layouts personalised to the viewing customer, not a fixed finished ad.
  const previewSrc = useMemo(() => templatePreviewDataUrl(template, brandKit), [template, brandKit]);
  return (
    <button
      type="button"
      className={`studio-tpl${active ? " active" : ""}`}
      aria-pressed={active}
      onClick={() => onSelect(template.id)}
    >
      <span className="studio-tpl-thumb studio-tpl-thumb--img">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="studio-tpl-photo" src={previewSrc} alt="" loading="lazy" />
      </span>
      <span className="studio-tpl-meta">
        <strong>{template.name}</strong>
        <span className="studio-tpl-tags">
          <span>{template.templateKey ?? template.id}</span>
          <span>{template.creativeSkeleton ? "DNA template" : template.source === "radar" ? "Approved library" : "Built-in"}</span>
        </span>
        <span>{template.promptHint}</span>
        {template.creativeSkeleton ? (
          <span>
            {template.creativeSkeleton.archetype.replace(/_/g, " ")}
            {template.exemplars?.length ? ` · ${template.exemplars.length} exemplars` : ""}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function BlankTemplateCard({ active, onSelect }: { active?: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`studio-tpl blank${active ? " active" : ""}`} aria-pressed={active} onClick={onSelect}>
      <span className="studio-tpl-thumb">
        <span className="plus"><Plus aria-hidden size={20} /></span>
      </span>
      <span className="studio-tpl-meta">
        <strong>Start blank</strong>
        <span>No template — describe it yourself</span>
      </span>
    </button>
  );
}

type TemplatesPanelProps = {
  templates: AdStudioTemplate[];
  brandKit: AdStudioBrandKit;
  onUseTemplate: (id: string) => void;
  onStartBlank: () => void;
};

export function TemplatesPanel({ templates, brandKit, onUseTemplate, onStartBlank }: TemplatesPanelProps) {
  return (
    <>
      <PanelHeader title="Templates" detail="Each preview uses your brand — add your listing photo and the copy writes itself." />
      <div className="studio-tpl-grid">
        {templates.map((template) => (
          <TemplateCard key={template.id} template={template} brandKit={brandKit} onSelect={onUseTemplate} />
        ))}
        <BlankTemplateCard onSelect={onStartBlank} />
      </div>
    </>
  );
}
