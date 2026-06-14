"use client";

import { Plus } from "lucide-react";

import type { AdStudioTemplate } from "@/lib/adstudio";
import { resolveTemplateImage } from "@/lib/adstudio/templates.ts";

import { PanelHeader } from "../inspector";

// Presentation-only preview copy for the gallery thumbnails.
// Falls back to the template's own name/promptHint when not listed.
const PREVIEW_COPY: Record<string, { headline: string; cta: string }> = {
  just_listed: { headline: "Just listed in South Perth", cta: "See the home" },
  coming_soon: { headline: "Something special is coming soon", cta: "Get first look" },
  new_to_market: { headline: "Fresh activity on your street", cta: "See recent sales" },
  open_home: { headline: "Open Sat 11:00 — save your spot", cta: "Plan your visit" },
  just_sold: { headline: "SOLD — strong local result", cta: "See what yours could get" },
  price_update: { headline: "What's your home worth now?", cta: "Get a price update" },
  market_update: { headline: "What sold near you this quarter", cta: "Get the report" },
  free_appraisal: { headline: "What's your home worth in 2026?", cta: "Book free appraisal" },
  buyer_demand: { headline: "Buyers are searching your suburb", cta: "Check buyer demand" },
  seller_checklist: { headline: "10 things to fix before you list", cta: "Download checklist" },
};

const GRADIENT_COUNT = 7;

function gradientClass(template: AdStudioTemplate, index: number): string {
  return `studio-tpl-g${index % GRADIENT_COUNT}`;
}

type TemplateCardProps = {
  template: AdStudioTemplate;
  index: number;
  active?: boolean;
  onSelect: (id: string) => void;
};

export function TemplateCard({ template, index, active, onSelect }: TemplateCardProps) {
  const preview = PREVIEW_COPY[template.id] ?? { headline: template.name, cta: "Learn more" };
  // Every template resolves to a finished, on-brand ad image. Show it clean —
  // like an Ad Radar creative — with no overlaid tag/headline/CTA on top.
  const image = resolveTemplateImage(template);
  return (
    <button
      type="button"
      className={`studio-tpl${active ? " active" : ""}`}
      aria-pressed={active}
      onClick={() => onSelect(template.id)}
    >
      {image ? (
        <span className="studio-tpl-thumb studio-tpl-thumb--img">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="studio-tpl-photo" src={image.src} alt="" loading="lazy" />
        </span>
      ) : (
        <span className={`studio-tpl-thumb ${gradientClass(template, index)}`}>
          <span className="tag">{template.name}</span>
          <span className="t-copy">{preview.headline}</span>
          <span className="t-cta">{preview.cta}</span>
        </span>
      )}
      <span className="studio-tpl-meta">
        <strong>{template.name}</strong>
        <span>{template.promptHint}</span>
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
  onUseTemplate: (id: string) => void;
  onStartBlank: () => void;
};

export function TemplatesPanel({ templates, onUseTemplate, onStartBlank }: TemplatesPanelProps) {
  return (
    <>
      <PanelHeader title="Templates" detail="Proven starting points — pick one to create a new ad." />
      <div className="studio-tpl-grid">
        {templates.map((template, index) => (
          <TemplateCard key={template.id} template={template} index={index} onSelect={onUseTemplate} />
        ))}
        <BlankTemplateCard onSelect={onStartBlank} />
      </div>
    </>
  );
}
