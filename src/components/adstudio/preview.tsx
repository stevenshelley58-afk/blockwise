"use client";

import { Check, ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import type { CSSProperties } from "react";

import type { CopyState } from "./use-copy";

export type PreviewFormat = "story" | "feed" | "square" | "landscape";
export type PreviewMode = "platform" | "creative";
export type SelectedElement = "headline" | "primaryText" | "description" | "cta" | "image";

export const FORMAT_META: Record<
  PreviewFormat,
  { label: string; size: string }
> = {
  story: { label: "Story", size: "1080x1920" },
  feed: { label: "Feed", size: "1080x1350" },
  square: { label: "Square", size: "1080x1080" },
  landscape: { label: "Landscape", size: "1200x628" },
};

type PreviewControlsProps = {
  previewFormat: PreviewFormat;
  setPreviewFormat: (format: PreviewFormat) => void;
};

export function PreviewControls({
  previewFormat,
  setPreviewFormat,
}: PreviewControlsProps) {
  return (
    <div className="studio-preview-controls">
      <div className="studio-segment">
        {(["story", "feed", "square"] as PreviewFormat[]).map((item) => (
          <button className={previewFormat === item ? "active" : ""} key={item} type="button" onClick={() => setPreviewFormat(item)}>
            <span>{FORMAT_META[item].label}</span>
            <small>{FORMAT_META[item].size}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

type AdPreviewProps = {
  brand: string;
  domain: string;
  initials: string;
  copy: CopyState;
  image: string;
  format: PreviewFormat;
  mode: PreviewMode;
  zoom: number;
  selectedElement: SelectedElement;
  setSelectedElement: (element: SelectedElement) => void;
};

type VariantStripProps = {
  variants: Array<{ variantId: string; displayName: string; angleLabel: string; image: string; headline: string }>;
  selectedVariantIndex: number;
  onSelect: (index: number) => void;
  onAdd?: () => void;
  onEditCopy?: (index: number) => void;
  onReplaceImage?: (index: number) => void;
  onRegenerate?: (index: number) => void;
  compact?: boolean;
};

export function VariantStrip({
  variants,
  selectedVariantIndex,
  onSelect,
  onAdd,
  onEditCopy,
  onReplaceImage,
  onRegenerate,
  compact = false,
}: VariantStripProps) {
  return (
    <div className={compact ? "studio-variant-strip compact" : "studio-variant-strip"}>
      <div className="studio-variant-strip-head">
        <strong>Generated ads</strong>
        {!compact && (
          <button type="button" onClick={onAdd}>
            <Plus aria-hidden size={16} />
            Add ad
          </button>
        )}
      </div>
      <div className="studio-variant-row">
        {variants.map((variant, index) => (
          <article className={selectedVariantIndex === index ? "studio-variant-tile active" : "studio-variant-tile"} key={variant.variantId}>
            <button className="studio-variant-preview" type="button" onClick={() => onSelect(index)}>
              <span className="studio-variant-image">
                <img src={variant.image} alt="" />
                {selectedVariantIndex === index ? <Check aria-hidden size={15} /> : null}
              </span>
              <strong>{variant.displayName}</strong>
              <small>{variant.angleLabel}</small>
            </button>
            {!compact && (
              <div className="studio-variant-actions">
                <button type="button" onClick={() => onEditCopy?.(index)}>Edit copy</button>
                <button type="button" onClick={() => onReplaceImage?.(index)}>Replace image</button>
                <button type="button" onClick={() => onRegenerate?.(index)}>Regenerate</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

export function AdPreview({
  brand,
  domain,
  initials,
  copy,
  image,
  format,
  mode,
  zoom,
  selectedElement,
  setSelectedElement,
}: AdPreviewProps) {
  const transform = { "--preview-scale": String(zoom / 100) } as CSSProperties;

  if (format === "story") {
    return (
      <div className="studio-preview-device" style={transform}>
        <div className={mode === "creative" ? "studio-story-card creative" : "studio-story-card"}>
          <img src={image} alt="" />
          <span className="studio-story-shade" />
          {mode === "platform" && (
            <div className="studio-story-brand">
              <span>{initials}</span>
              <div>
                <strong>{brand}</strong>
                <small>Sponsored</small>
              </div>
            </div>
          )}
          <button className="studio-hit image" type="button" aria-label="Edit image" onClick={() => setSelectedElement("image")} />
          <button
            className={selectedElement === "headline" ? "studio-story-headline selected" : "studio-story-headline"}
            type="button"
            onClick={() => setSelectedElement("headline")}
          >
            {copy.headline}
          </button>
          <button
            className={selectedElement === "description" ? "studio-story-body selected" : "studio-story-body"}
            type="button"
            onClick={() => setSelectedElement("description")}
          >
            {copy.description}
          </button>
          <button className={selectedElement === "cta" ? "studio-story-cta selected" : "studio-story-cta"} type="button" onClick={() => setSelectedElement("cta")}>
            {copy.cta}
            <ChevronRight aria-hidden size={17} />
          </button>
        </div>
      </div>
    );
  }

  // aspect ratio for each format: story handled above, landscape uses CSS class
  const feedAspectRatio = format === "feed" ? "4/5" : format === "landscape" ? "1.91/1" : "1/1";

  if (mode === "creative") {
    return (
      <div className="studio-preview-device" style={transform}>
        <div
          className={format === "landscape" ? "studio-creative-card landscape" : "studio-creative-card"}
          style={format === "feed" ? { aspectRatio: "4/5" } : undefined}
        >
          <img src={image} alt="" />
          <span className="studio-creative-shade" />
          <button className="studio-hit image" type="button" aria-label="Edit image" onClick={() => setSelectedElement("image")} />
          <button
            className={selectedElement === "headline" ? "studio-creative-headline selected" : "studio-creative-headline"}
            type="button"
            onClick={() => setSelectedElement("headline")}
          >
            {copy.headline}
          </button>
          <button
            className={selectedElement === "description" ? "studio-creative-body selected" : "studio-creative-body"}
            type="button"
            onClick={() => setSelectedElement("description")}
          >
            {copy.description}
          </button>
          <button className={selectedElement === "cta" ? "studio-creative-cta selected" : "studio-creative-cta"} type="button" onClick={() => setSelectedElement("cta")}>
            {copy.cta}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="studio-preview-device" style={transform}>
      <article className={format === "landscape" ? "studio-feed-card landscape" : "studio-feed-card"}>
        {mode === "platform" && (
          <header>
            <div className="studio-feed-id">
              <span>{initials}</span>
              <div>
                <strong>{brand}</strong>
                <small>Sponsored</small>
              </div>
            </div>
            <MoreHorizontal aria-hidden size={18} />
          </header>
        )}
        {mode === "platform" && (
          <button className={selectedElement === "primaryText" ? "studio-feed-primary selected" : "studio-feed-primary"} type="button" onClick={() => setSelectedElement("primaryText")}>
            {copy.primaryText}
          </button>
        )}
        <button className="studio-feed-image" type="button" onClick={() => setSelectedElement("image")}>
          <img src={image} alt="" style={format !== "landscape" ? { aspectRatio: feedAspectRatio } : undefined} />
        </button>
        <footer>
          <div>
            <small>{domain}</small>
            <button className={selectedElement === "headline" ? "studio-feed-headline selected" : "studio-feed-headline"} type="button" onClick={() => setSelectedElement("headline")}>
              {copy.headline}
            </button>
            <button className={selectedElement === "description" ? "studio-feed-desc selected" : "studio-feed-desc"} type="button" onClick={() => setSelectedElement("description")}>
              {copy.description}
            </button>
          </div>
          <button className={selectedElement === "cta" ? "studio-feed-cta selected" : "studio-feed-cta"} type="button" onClick={() => setSelectedElement("cta")}>
            {copy.cta}
          </button>
        </footer>
      </article>
    </div>
  );
}
