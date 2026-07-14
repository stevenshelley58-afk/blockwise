"use client";

import { Check, ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import type { AdStudioBrandKit } from "@/lib/adstudio";
import { resolveAdvertiserDomain } from "@/lib/adstudio/advertiser-domain";
import { labelForMetaCta, toMetaCta } from "@/lib/adstudio/meta-cta";

import type { CopyState } from "./use-copy";

export type PreviewFormat = "story" | "feed";
export type SelectedElement = "canvas" | "headline" | "primaryText" | "description" | "cta" | "image";

export const FORMAT_META: Record<
  PreviewFormat,
  { label: string; size: string }
> = {
  story: { label: "Story", size: "1080x1920" },
  feed: { label: "Feed", size: "1080x1350" },
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
        {(["story", "feed"] as PreviewFormat[]).map((item) => (
          <button className={previewFormat === item ? "active" : ""} key={item} type="button" onClick={() => setPreviewFormat(item)}>
            <span>{FORMAT_META[item].label}</span>
            <small>{FORMAT_META[item].size}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

const META_PRIMARY_VISIBLE_LINES = 4;
const META_PRIMARY_VISIBLE_CHARS = 220;

export function formatMetaPrimaryText(text: string): string {
  const normalised = text.replace(/\r\n?/g, "\n").trim();
  const lines = normalised.split("\n");
  const visibleLines = lines.slice(0, META_PRIMARY_VISIBLE_LINES);
  let visible = visibleLines.join("\n").trimEnd();
  let truncated = lines.length > META_PRIMARY_VISIBLE_LINES || normalised.length > META_PRIMARY_VISIBLE_CHARS;

  if (visible.length > META_PRIMARY_VISIBLE_CHARS) {
    visible = visible.slice(0, META_PRIMARY_VISIBLE_CHARS).trimEnd();
    truncated = true;
  }

  return truncated ? `${visible}... See more` : visible;
}

function metaPageName(brandKit: AdStudioBrandKit): string {
  return brandKit.identity.tradingName?.trim() || brandKit.identity.businessName || "Your agency";
}

function metaAvatarUrl(brandKit: AdStudioBrandKit): string | null {
  return brandKit.logos.primaryLogoUrl || brandKit.logos.faviconUrl || null;
}

function MetaAvatar({ brandKit }: { brandKit: AdStudioBrandKit }) {
  const pageName = metaPageName(brandKit);
  const avatarUrl = metaAvatarUrl(brandKit);
  const initial = pageName.charAt(0).toUpperCase();

  return (
    <span className="studio-meta-avatar" aria-hidden>
      {avatarUrl ? <img src={avatarUrl} alt="" /> : initial}
    </span>
  );
}

type MetaChromePreviewProps = {
  format: PreviewFormat;
  brandKit: AdStudioBrandKit;
  destinationUrl?: string;
  /** Live copy state — edits in the Text panel show up immediately. */
  copy: CopyState;
  /** The creative itself (the in-place clone editor); the chrome wraps, never replaces it. */
  children: ReactNode;
  /** Clicking the primary text or headline/description focuses the Text panel. */
  onSelectText?: () => void;
};

/**
 * Renders the ad exactly as Meta does around the embedded creative —
 * page header (avatar, brand, Sponsored), primary text above the creative,
 * then the headline/description strip with the real CTA enum button label.
 * Story format overlays the chrome instead (avatar, progress bars, CTA pill)
 * with pointer-events disabled so in-place edit regions stay clickable.
 */
export function MetaChromePreview({ format, brandKit, destinationUrl, copy, children, onSelectText }: MetaChromePreviewProps) {
  const pageName = metaPageName(brandKit);
  const domain = resolveAdvertiserDomain({ brandKit, finalUrls: [destinationUrl] });
  const ctaLabel = labelForMetaCta(toMetaCta(copy.cta));
  const primaryText = formatMetaPrimaryText(copy.primaryText);

  if (format === "story") {
    return (
      <div className="studio-metachrome-story">
        {children}
        <div className="studio-metachrome-story-chrome">
          <span className="studio-metachrome-story-progress" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <div className="studio-story-brand studio-metachrome-story-brand">
            <MetaAvatar brandKit={brandKit} />
            <div>
              <strong>{pageName}</strong>
              <small>Sponsored</small>
            </div>
          </div>
          <span className="studio-story-cta studio-metachrome-story-cta">
            Learn more
            <ChevronRight aria-hidden size={17} />
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="studio-metachrome">
      <article className="studio-feed-card studio-metachrome-card" data-format={format}>
        <header>
          <div className="studio-feed-id">
            <MetaAvatar brandKit={brandKit} />
            <div>
              <strong>{pageName}</strong>
              <small>Sponsored</small>
            </div>
          </div>
          <MoreHorizontal aria-hidden size={18} />
        </header>
        <button className="studio-feed-primary studio-metachrome-copy" type="button" onClick={onSelectText}>
          {primaryText}
        </button>
        <div className="studio-metachrome-media">{children}</div>
        <footer>
          <div>
            <small>{domain.host}</small>
            <button className="studio-feed-headline studio-metachrome-copy" type="button" onClick={onSelectText}>
              {copy.headline}
            </button>
            <button className="studio-feed-desc studio-metachrome-copy" type="button" onClick={onSelectText}>
              {copy.description}
            </button>
          </div>
          <span className="studio-feed-cta">{ctaLabel}</span>
        </footer>
      </article>
      {domain.setupNudge ? <p className="studio-metachrome-nudge">{domain.setupNudge}</p> : null}
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
  /** Staged generation: skeleton tiles + phase label while ads are being generated. */
  pending?: { phase: string; count: number; error: string | null } | null;
  onRetryPending?: () => void;
  onDismissPending?: () => void;
  compact?: boolean;
};

export function VariantStrip({
  variants,
  selectedVariantIndex,
  onSelect,
  onAdd,
  onEditCopy,
  onReplaceImage,
  pending = null,
  onRetryPending,
  onDismissPending,
  compact = false,
}: VariantStripProps) {
  const generating = Boolean(pending && !pending.error);
  const generationFailed = Boolean(pending?.error);

  return (
    <div className={compact ? "studio-variant-strip compact" : "studio-variant-strip"}>
      <div className="studio-variant-strip-head">
        <strong aria-live="polite">{generating ? pending?.phase : "Generated ads"}</strong>
        {generationFailed && (
          <span className="studio-variant-head-actions">
            {onRetryPending && (
              <button type="button" onClick={onRetryPending}>Try again</button>
            )}
            {onDismissPending && (
              <button type="button" onClick={onDismissPending}>Dismiss</button>
            )}
          </span>
        )}
        {!compact && !generationFailed && (
          <button type="button" onClick={onAdd} disabled={generating}>
            <Plus aria-hidden size={16} />
            Add ad
          </button>
        )}
      </div>
      <div className="studio-variant-row">
        {pending
          ? Array.from({ length: pending.count }).map((_, index) =>
              pending.error ? (
                <article className="studio-variant-tile error" key={`pending-${index}`}>
                  <span className="studio-variant-error-box" role={index === 0 ? "alert" : undefined}>
                    <strong>Ad {index + 1} failed</strong>
                    <small>{index === 0 ? pending.error : "Not generated - try again."}</small>
                  </span>
                </article>
              ) : (
                <article className="studio-variant-tile" key={`pending-${index}`} aria-hidden>
                  <span className="studio-variant-skeleton">
                    <i className="studio-variant-skeleton-image" />
                    <i className="studio-variant-skeleton-line" />
                    <i className="studio-variant-skeleton-line short" />
                  </span>
                </article>
              ),
            )
          : variants.map((variant, index) => (
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
  zoom,
  selectedElement,
  setSelectedElement,
}: AdPreviewProps) {
  const transform = { "--preview-scale": String(zoom / 100) } as CSSProperties;

  if (format === "story") {
    return (
      <div className="studio-preview-device" style={transform}>
        <div className="studio-story-card">
          <img src={image} alt="" />
          <span className="studio-story-shade" />
          <div className="studio-story-brand">
            <span>{initials}</span>
            <div>
              <strong>{brand}</strong>
              <small>Sponsored</small>
            </div>
          </div>
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

  // aspect ratio for each format: story handled above
  const feedAspectRatio = format === "feed" ? "4/5" : "1/1";

  return (
    <div className="studio-preview-device" style={transform}>
      <article className="studio-feed-card">
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
        <button className={selectedElement === "primaryText" ? "studio-feed-primary selected" : "studio-feed-primary"} type="button" onClick={() => setSelectedElement("primaryText")}>
          {copy.primaryText}
        </button>
        <button className="studio-feed-image" type="button" onClick={() => setSelectedElement("image")}>
          <img src={image} alt="" style={{ aspectRatio: feedAspectRatio }} />
        </button>
        <footer>
          <div>
            {domain ? <small>{domain}</small> : null}
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
