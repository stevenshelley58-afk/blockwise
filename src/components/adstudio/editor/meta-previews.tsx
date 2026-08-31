"use client";

import type { Layout, TemplatePack } from "../../../../packages/ad-template-pack-contract/src/types";
import { LayoutSchematic } from "./layout-schematic";
import { businessInitials, ctaLabelText, domainLabel, truncateForPreview } from "./preview-text";
import type { MetaCopy } from "./use-editor-state";

// ---------------------------------------------------------------------------
// Meta previews — placement-specific mockups of how the ad appears on
// Facebook/Instagram. Both wrap the REAL creative (LayoutSchematic with live
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
  layout: Layout;
  colours: TemplatePack["semanticColours"];
  textValues: Record<string, string>;
  imageValues: Record<string, string | null>;
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
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-600 text-white"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="font-semibold leading-none">{initials || "B"}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Feed preview — 4:5 creative inside a Facebook mobile feed post.
// ---------------------------------------------------------------------------

export function FeedPreview({
  layout,
  colours,
  textValues,
  imageValues,
  copy,
  businessName,
  logoUrl,
  destinationUrl,
  className,
}: MetaPreviewProps) {
  const domain = domainLabel(destinationUrl) || "your-business.com.au";
  return (
    <div className={`w-full max-w-[420px] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm ${className ?? ""}`} data-testid="meta-feed-preview">
      {/* Header: avatar, business name, Sponsored */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <BusinessAvatar businessName={businessName} logoUrl={logoUrl} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-semibold text-neutral-900">{businessName || "Your business"}</p>
          <p className="text-[11px] text-neutral-500">Sponsored</p>
        </div>
        <span className="text-neutral-400" aria-hidden="true">···</span>
      </div>

      {/* Primary text */}
      <p className="px-3 pb-2 text-[13px] leading-snug text-neutral-900">
        {truncateForPreview(copy.primaryText, 200) || "Your primary text appears here."}
      </p>

      {/* 4:5 creative */}
      <div className="aspect-[4/5] w-full bg-white">
        <LayoutSchematic
          layout={layout}
          colours={colours}
          textValues={textValues}
          imageValues={imageValues}
          preserveAspectRatio="xMidYMid slice"
          className="h-full w-full"
        />
      </div>

      {/* Link row: domain, headline, description, CTA */}
      <div className="flex items-stretch justify-between gap-2 border-t border-neutral-200 bg-neutral-100 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] uppercase tracking-wide text-neutral-500">{domain}</p>
          <p className="mt-0.5 truncate text-[14px] font-semibold text-neutral-900">
            {truncateForPreview(copy.headline, 60) || "Your headline"}
          </p>
          <p className="truncate text-[12px] text-neutral-500">
            {truncateForPreview(copy.description, 40) || "Your description"}
          </p>
        </div>
        <span className="flex shrink-0 items-center rounded-md bg-neutral-200 px-3 text-[13px] font-medium text-neutral-700">
          {ctaLabelText(copy.cta)}
        </span>
      </div>

      {/* Engagement footer */}
      <div className="flex items-center justify-between px-3 py-2 text-[12px] font-medium text-neutral-600">
        <span>👍 Like</span>
        <span>💬 Comment</span>
        <span>↗ Share</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Story preview — full 9:16 presentation with story chrome.
// ---------------------------------------------------------------------------

export function StoryPreview({
  layout,
  colours,
  textValues,
  imageValues,
  copy,
  businessName,
  logoUrl,
  className,
}: MetaPreviewProps) {
  return (
    <div
      className={`relative aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-xl bg-white shadow-sm ${className ?? ""}`}
      data-testid="meta-story-preview"
    >
      {/* The creative fills the frame */}
      <LayoutSchematic
        layout={layout}
        colours={colours}
        textValues={textValues}
        imageValues={imageValues}
        preserveAspectRatio="xMidYMid slice"
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
            {ctaLabelText(copy.cta)}
          </span>
          <span className="text-white/90" aria-hidden="true">↑</span>
        </div>
      </div>
    </div>
  );
}
