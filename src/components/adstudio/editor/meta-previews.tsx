"use client";

import type { Layout, AdTemplate, Rect } from "../../../../packages/ad-template-contract/src/types";
import { ArrowUp, MessageCircle, MoreHorizontal, Share2, ThumbsUp } from "lucide-react";
import { LayeredCanvas } from "./layered-canvas";
import { businessInitials, ctaLabelText, domainLabel, truncateForPreview } from "./preview-text";
import type { MetaCopy } from "./use-editor-state";
import { META_COPY_CONSTRAINTS } from "../../../lib/adstudio/meta-copy-contract";

// ---------------------------------------------------------------------------
// Meta previews — placement-specific mockups of how the ad appears on
// Facebook/Instagram. Both wrap the REAL creative (LayeredCanvas with live
// text/image values and the resolved palette) in Meta chrome, and both update
// immediately when copy, assets, colours, logo or business name change — they
// are pure functions of the editor state.
//
// Feed: avatar row (logo or initials), business name, Sponsored, primary text,
// 4:5 creative, destination domain, headline, description, CTA button and a
// Like · Comment · Share footer.
//
// Story: full 9:16 presentation with progress bars, profile row (avatar +
// business name + Sponsored), safe-area padding around the creative and the
// bottom CTA treatment.
// ---------------------------------------------------------------------------

export interface MetaPreviewProps {
  templateId: string;
  layout: Layout;
  colours: AdTemplate["semanticColours"];
  textValues: Record<string, string>;
  imageValues: Record<string, string | null>;
  cropOverrides?: Record<string, Rect | null | undefined>;
  copy: MetaCopy;
  businessName: string;
  logoUrl: string | null;
  /** Real destination domain shown under the creative; empty → neutral placeholder. */
  destinationUrl?: string;
  className?: string;
}

/** Circular avatar — the Brand Pack logo, or initials when none exists. */
export function BusinessAvatar({
  businessName,
  logoUrl,
  size = 40,
}: {
  businessName: string;
  logoUrl: string | null;
  size?: number;
}) {
  const initials = businessInitials(businessName);
  // Brand Pack URLs are commonly signed on a separate storage origin. Do not
  // put those URLs in this client preview: a CSP block would create a noisy
  // failed request. Same-origin paths are safe; otherwise use initials.
  const safeLogoUrl = logoUrl && logoUrl.startsWith("/") && !logoUrl.startsWith("//") ? logoUrl : null;
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-foreground"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      role="img"
      aria-label={`${businessName || "Business"} profile`}
    >
      {safeLogoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={safeLogoUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="font-semibold leading-none">{initials}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Feed preview — 4:5 creative inside a Facebook mobile feed post.
// ---------------------------------------------------------------------------

export function FeedPreview({
  templateId,
  layout,
  colours,
  textValues,
  imageValues,
  cropOverrides,
  copy,
  businessName,
  logoUrl,
  destinationUrl,
  className,
}: MetaPreviewProps) {
  const domain = domainLabel(destinationUrl) || "Destination not set";
  const primaryText = truncateForPreview(copy.primaryText, META_COPY_CONSTRAINTS.primaryText);
  const headline = truncateForPreview(copy.headline, META_COPY_CONSTRAINTS.headline);
  const description = truncateForPreview(copy.description, META_COPY_CONSTRAINTS.description);
  const cta = truncateForPreview(ctaLabelText(copy.cta), META_COPY_CONSTRAINTS.cta) || "Learn more";
  return (
    <div className={`w-full max-w-[420px] overflow-hidden rounded-lg border border-border bg-card shadow-sm ${className ?? ""}`} data-testid="meta-feed-preview">
      {/* Header: avatar, business name, Sponsored */}
      <div className="flex items-center gap-2.5 px-4 py-3">
        <BusinessAvatar businessName={businessName} logoUrl={logoUrl} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-semibold text-foreground">{businessName || "Your business"}</p>
          <p className="text-[11px] text-muted-foreground">Sponsored</p>
        </div>
        <MoreHorizontal className="size-5 text-muted-foreground" aria-label="More options" />
      </div>

      {/* Primary text */}
      <p className="px-4 pb-3 text-[13px] leading-relaxed text-foreground">
        {primaryText || "Your primary text appears here."}
      </p>

      {/* 4:5 creative */}
      <div className="aspect-[4/5] w-full bg-white">
        <LayeredCanvas
          templateId={templateId}
          layout={layout}
          colours={colours}
          imageValues={imageValues}
          textValues={textValues}
          cropOverrides={cropOverrides}
          className="h-full w-full"
        />
      </div>

      {/* Link row: domain, headline, description, CTA */}
      <div className="flex items-stretch justify-between gap-3 border-t border-border bg-muted/50 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{domain}</p>
          <p className="mt-0.5 truncate text-[14px] font-semibold text-foreground">
            {headline || "Your headline"}
          </p>
          <p className="truncate text-[12px] text-muted-foreground">
            {description || "Your description"}
          </p>
        </div>
        <span className="flex shrink-0 items-center rounded-md border border-border bg-card px-3 text-[13px] font-medium text-foreground">
          {cta}
        </span>
      </div>

      {/* Engagement footer */}
      <div className="flex items-center justify-around border-t border-border px-3 py-2 text-[12px] font-medium text-muted-foreground" role="group" aria-label="Post actions">
        <span className="inline-flex items-center gap-1"><ThumbsUp className="size-4" aria-hidden="true" />Like</span>
        <span className="inline-flex items-center gap-1"><MessageCircle className="size-4" aria-hidden="true" />Comment</span>
        <span className="inline-flex items-center gap-1"><Share2 className="size-4" aria-hidden="true" />Share</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Story preview — full 9:16 presentation with story chrome.
// ---------------------------------------------------------------------------

export function StoryPreview({
  templateId,
  layout,
  colours,
  textValues,
  imageValues,
  cropOverrides,
  copy,
  businessName,
  logoUrl,
  className,
}: MetaPreviewProps) {
  return (
    <div
      className={`relative aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-lg bg-card shadow-sm ${className ?? ""}`}
      data-testid="meta-story-preview"
    >
      {/* The creative fills the frame */}
      <LayeredCanvas
        templateId={templateId}
        layout={layout}
        colours={colours}
        imageValues={imageValues}
        textValues={textValues}
        cropOverrides={cropOverrides}
        className="absolute inset-0 h-full w-full"
      />

      {/* Top safe area: progress bars + profile row */}
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/45 to-transparent px-3 pb-8 pt-2">
        <div className="mb-2 flex gap-1" aria-hidden="true">
          {[0, 1, 2, 3].map((bar) => (
            <span key={bar} className={`h-0.5 flex-1 rounded-full ${bar === 0 ? "bg-white" : "bg-white/40"}`} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <BusinessAvatar businessName={businessName} logoUrl={logoUrl} size={28} />
          <p className="truncate text-[12px] font-semibold text-white drop-shadow">{businessName || "Your business"}</p>
          <p className="text-[12px] text-white/80 drop-shadow">Sponsored</p>
        </div>
      </div>

      {/* Bottom safe area: CTA treatment */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-3 pb-4 pt-10">
        <div className="flex items-center justify-between gap-2">
          <span className="max-w-[70%] truncate rounded-full bg-white/95 px-4 py-2 text-[12px] font-semibold text-neutral-900 shadow">
            {truncateForPreview(ctaLabelText(copy.cta), META_COPY_CONSTRAINTS.cta) || "Learn more"}
          </span>
          <ArrowUp className="size-4 text-white/90" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
