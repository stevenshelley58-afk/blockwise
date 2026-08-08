"use client";

// Shared chrome bits for the Meta placement frames. The frames replicate
// Meta's current visual layout (values ported from the old .studio-metachrome
// CSS, themselves measured from Meta); Blockwise design tokens are NOT used
// here on purpose — this chrome belongs to Meta, not to the brand.

import type { ReactNode } from "react";

import type { AdStudioBrandKit } from "@/lib/adstudio";

export type MetaFrameCopy = {
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
};

export type MetaFrameCopyElement = "primaryText" | "headline" | "description" | "cta";

export type MetaFrameCommonProps = {
  brandKit: AdStudioBrandKit;
  copy: MetaFrameCopy;
  destinationUrl?: string;
  children: ReactNode;
  onSelectText?: (element: MetaFrameCopyElement) => void;
  selectedElement?: MetaFrameCopyElement | string;
};

export function metaPageName(brandKit: AdStudioBrandKit): string {
  return brandKit.identity.tradingName?.trim() || brandKit.identity.businessName || "Your agency";
}

export function MetaFrameAvatar({
  brandKit,
  size = 40,
  dark = false,
}: {
  brandKit: AdStudioBrandKit;
  size?: number;
  /** On dark scrims (stories/reels) the avatar chip goes translucent white. */
  dark?: boolean;
}) {
  const pageName = metaPageName(brandKit);
  const avatarUrl = brandKit.logos.primaryLogoUrl || brandKit.logos.faviconUrl || null;
  const initial = pageName.charAt(0).toUpperCase();

  return (
    <span
      aria-hidden
      className={
        dark
          ? "flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/40 bg-white/20 font-semibold text-white"
          : "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#e4e6eb] font-semibold text-[#050505]"
      }
      style={{ width: size, height: size, fontSize: Math.round(size * 0.47) }}
    >
      {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : initial}
    </span>
  );
}

/**
 * A piece of Meta copy the customer can click to focus its editor field.
 * Renders as a real button so keyboard users can reach it (44px hit area via
 * min-h + padding), and mirrors the old frame's selected state outline.
 */
export function MetaFrameCopyButton({
  element,
  selectedElement,
  onSelectText,
  className,
  children,
}: {
  element: MetaFrameCopyElement;
  selectedElement?: MetaFrameCopyElement | string;
  onSelectText?: (element: MetaFrameCopyElement) => void;
  className: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selectedElement === element}
      data-selected={selectedElement === element || undefined}
      onClick={() => onSelectText?.(element)}
      className={`min-h-0 cursor-pointer text-left transition-colors data-[selected]:bg-[#f1f2f4] data-[selected]:outline-2 data-[selected]:outline-offset-2 data-[selected]:outline-[#16181d] hover:text-[var(--accent,#16181d)] ${className}`}
    >
      {children}
    </button>
  );
}
