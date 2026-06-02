"use client";

import { Check, ChevronRight, Circle, CircleAlert, Download, Image as ImageIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";

import type { InspectorTab } from "./use-ad-studio";
import type { CopyState } from "./use-copy";
import { COPY_LIMITS } from "./use-copy";
import type { ReadinessItem } from "./use-readiness";
import type { SelectedElement } from "./preview";

export function PanelHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="studio-panel-header">
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}

export function FieldShell({ label, icon: Icon, children }: { label: string; icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <label className="studio-field">
      <span>{label}</span>
      <div>
        {Icon ? <Icon aria-hidden size={17} /> : null}
        {children}
      </div>
    </label>
  );
}

type CopyFieldsProps = { copy: CopyState; updateCopy: (key: keyof CopyState, value: string) => void };

export function CopyFields({ copy, updateCopy }: CopyFieldsProps) {
  return (
    <div className="studio-copy-fields">
      {([
        ["primaryText", "Primary text"],
        ["headline", "Headline"],
        ["description", "Description"],
        ["cta", "CTA"],
      ] as Array<[keyof CopyState, string]>).map(([key, label]) => (
        <label key={key}>
          <span>
            {label}
            <small>{copy[key].length} / {COPY_LIMITS[key]}</small>
          </span>
          <textarea rows={key === "primaryText" ? 3 : 2} value={copy[key]} onChange={(event) => updateCopy(key, event.target.value)} />
        </label>
      ))}
    </div>
  );
}

type ReadinessCardProps = { score: number; items: ReadinessItem[]; compact: boolean };

export function ReadinessCard({ score, items, compact }: ReadinessCardProps) {
  return (
    <section className={compact ? "studio-readiness compact" : "studio-readiness"}>
      <header>
        <h3>Campaign readiness</h3>
        {!compact && <ChevronRight aria-hidden size={20} />}
      </header>
      <div className="studio-readiness-main">
        <div className="studio-score" style={{ "--score": `${score}%` } as CSSProperties}>
          <span>{score}%</span>
        </div>
        {!compact && <p>Great. You are almost ready to publish.</p>}
      </div>
      <div className="studio-checklist">
        {items.map((item) => (
          <div className={item.state} key={item.label}>
            <span className="studio-check-icon">
              {item.state === "done" ? <Check aria-hidden size={13} /> : item.state === "warn" ? <CircleAlert aria-hidden size={13} /> : <Circle aria-hidden size={13} />}
            </span>
            <div>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </div>
          </div>
        ))}
      </div>
      {!compact && (
        <button className="studio-recommendations" type="button">
          View all recommendations
          <ChevronRight aria-hidden size={16} />
        </button>
      )}
    </section>
  );
}

type PublishPanelProps = { destinationUrl: string; blocker: string; onExport: () => void };

export function PublishPanel({ destinationUrl, blocker, onExport }: PublishPanelProps) {
  return (
    <div className="studio-publish-panel">
      <PanelHeader title="Publish" detail="Manual export first. Live publishing remains gated." />
      {blocker ? <div className="studio-publish-blocker">{blocker}</div> : <div className="studio-publish-ready">Ready to publish manually.</div>}
      {[
        ["Formats included", "Story, Feed, Square"],
        ["Destination", destinationUrl || "Missing"],
        ["Budget", "Set in ad account"],
        ["Schedule", "Set in ad account"],
        ["Tracking", "Needs confirmation"],
        ["Approval status", "Draft review"],
      ].map(([label, value]) => (
        <div className="studio-publish-row" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
      <button className="studio-btn publish block" type="button" onClick={onExport} disabled={Boolean(blocker)}>
        <Download aria-hidden size={17} />
        Export creatives
      </button>
    </div>
  );
}

type VariantItem = { variantId: string; displayName: string; angleLabel: string; image: string; headline: string; offer: string; cta: string };

type InspectorProps = {
  tab: InspectorTab;
  setTab: (tab: InspectorTab) => void;
  readinessScore: number;
  readinessItems: ReadinessItem[];
  variants: VariantItem[];
  selectedVariantIndex: number;
  onSelectVariant: (index: number) => void;
  onRegenerate?: (variantId: string) => void;
  selectedElement: SelectedElement;
  copy: CopyState;
  updateCopy: (key: keyof CopyState, value: string) => void;
  openFilePicker: () => void;
  applyCopyAssist: (action: string) => void;
  destinationUrl: string;
  publishBlocker: string;
  onExport: () => void;
};

export function Inspector({
  tab,
  setTab,
  readinessScore,
  readinessItems,
  variants,
  selectedVariantIndex,
  onSelectVariant,
  onRegenerate = () => {},
  selectedElement,
  copy,
  updateCopy,
  openFilePicker,
  applyCopyAssist,
  destinationUrl,
  publishBlocker,
  onExport,
}: InspectorProps) {
  return (
    <>
      <div className="studio-inspector-tabs">
        {(["checklist", "variants", "edit", "publish"] as InspectorTab[]).map((item) => (
          <button className={tab === item ? "active" : ""} key={item} type="button" onClick={() => setTab(item)}>
            {item.charAt(0).toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      {tab === "checklist" && <ReadinessCard score={readinessScore} items={readinessItems} compact={false} />}
      {tab === "variants" && (
        <div className="studio-inspector-list">
          {variants.map((variant, index) => (
            <article className={selectedVariantIndex === index ? "active" : ""} key={variant.variantId}>
              <img src={variant.image} alt="" />
              <div>
                <strong>{variant.displayName}: {variant.angleLabel}</strong>
                <small>{variant.headline}</small>
                <div className="studio-card-actions">
                  <button type="button" onClick={() => onSelectVariant(index)}>Preview</button>
                  <button type="button" onClick={() => onSelectVariant(index)}>Use</button>
                  {/* Duplicate variant — Wave 2 will wire a per-variant duplicate endpoint */}
                  <button type="button">Duplicate</button>
                  {/* H9: Regenerate — POST /api/adstudio/campaigns/{id}/regenerate */}
                  <button type="button" onClick={() => onRegenerate(variant.variantId)}>Regenerate</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {tab === "edit" && (
        <div className="studio-edit-panel">
          <PanelHeader title={selectedElement === "image" ? "Edit image" : "Edit copy"} detail={selectedElement === "image" ? "Replace and crop inside safe areas." : "Keep copy clear and local."} />
          {selectedElement === "image" ? (
            <>
              <button className="studio-btn secondary block" type="button" onClick={openFilePicker}>
                <ImageIcon aria-hidden size={17} />
                Replace image
              </button>
              {["Crop", "Fit", "Dark overlay", "Brightness", "Safe area"].map((label) => (
                <label className="studio-toggle-row" key={label}>
                  <span>{label}</span>
                  <input type="checkbox" defaultChecked={label === "Dark overlay" || label === "Safe area"} />
                </label>
              ))}
            </>
          ) : (
            <>
              <CopyFields copy={copy} updateCopy={updateCopy} />
              <div className="studio-assist-row">
                {["Make sharper", "Make more local", "Make more premium", "Make more direct", "Reduce hype", "Generate 5 hooks"].map((label) => (
                  <button key={label} type="button" onClick={() => applyCopyAssist(label)}>
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {tab === "publish" && <PublishPanel destinationUrl={destinationUrl} blocker={publishBlocker} onExport={onExport} />}
    </>
  );
}
