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
  const previewSrc = useMemo(() => templatePreviewDataUrl(template, brandKit), [template, brandKit]);
  const sampleHeadline = template.sampleCopy?.headline;
  const sampleBody = template.sampleCopy?.primaryText;

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
          <span>{template.source === "radar" ? "Template library" : "Built-in"}</span>
        </span>
        <span>{sampleHeadline ?? template.promptHint}</span>
        {sampleBody ? <span>{sampleBody}</span> : null}
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
        <span>No template - describe it yourself</span>
      </span>
    </button>
  );
}

type TemplatesPanelProps = {
  templates: AdStudioTemplate[];
  brandKit: AdStudioBrandKit;
  onUseTemplate: (id: string) => void;
  onStartBlank: () => void;
  showHeader?: boolean;
};

export function TemplatesPanel({ templates, brandKit, onUseTemplate, onStartBlank, showHeader = true }: TemplatesPanelProps) {
  return (
    <>
      {showHeader && <PanelHeader title="Templates" detail="Template library reset. Fresh self-contained templates have not been installed yet." />}
      <div className="studio-tpl-grid">
        {templates.length === 0 ? (
          <p className="studio-empty">No templates installed.</p>
        ) : (
          templates.map((template) => (
            <TemplateCard key={template.id} template={template} brandKit={brandKit} onSelect={onUseTemplate} />
          ))
        )}
        <BlankTemplateCard onSelect={onStartBlank} />
      </div>
    </>
  );
}
