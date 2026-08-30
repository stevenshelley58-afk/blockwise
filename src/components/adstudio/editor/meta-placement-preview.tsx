"use client";

import type { ReactNode } from "react";
import {
  Globe2,
  MessageCircle,
  MoreHorizontal,
  Share2,
  ThumbsUp,
} from "lucide-react";

import type { Placement } from "../../../../packages/ad-template-contract/src/types";
import type { MetaCopy } from "./use-editor-state";
import { labelForMetaCta, toMetaCta } from "@/lib/adstudio/meta-cta";
import { cn } from "@/lib/utils";

export type MetaPreviewBrand = {
  businessName: string;
  displayDomain: string;
  logoUrl?: string | null;
};

export function MetaPlacementPreview({
  placement,
  brand,
  copy,
  creative,
}: {
  placement: Placement;
  brand: MetaPreviewBrand;
  copy: MetaCopy;
  creative: ReactNode;
}) {
  return placement === "story" ? (
    <MetaStoryPreview brand={brand} copy={copy} creative={creative} />
  ) : (
    <MetaFeedPreview brand={brand} copy={copy} creative={creative} />
  );
}

function MetaFeedPreview({ brand, copy, creative }: { brand: MetaPreviewBrand; copy: MetaCopy; creative: ReactNode }) {
  const headline = copy.headline.trim() || "Your headline";
  const description = copy.description.trim() || "A short description of your offer";
  const primaryText = copy.primaryText.trim() || "Your primary ad copy will appear here.";

  return (
    <article
      aria-label="Facebook Feed ad preview"
      className="w-full max-w-[500px] overflow-hidden rounded-[12px] border border-black/10 bg-white font-sans text-[#050505] shadow-[0_18px_55px_rgba(15,23,42,0.14)]"
    >
      <header className="flex items-center gap-2.5 px-3 py-2.5">
        <PageAvatar brand={brand} size="md" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[14px] font-semibold">{brand.businessName}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[12px] text-[#65676b]">
            Sponsored <span aria-hidden>·</span> <Globe2 aria-hidden className="size-3" />
          </p>
        </div>
        <MoreHorizontal aria-hidden className="size-5 text-[#65676b]" />
      </header>

      <div className="px-3 pb-3 text-[14px] leading-[1.35]">
        <p className="line-clamp-4 whitespace-pre-line">{primaryText}</p>
      </div>

      <div className="aspect-[4/5] w-full overflow-hidden bg-[#e4e6eb]">{creative}</div>

      <div className="flex min-h-[68px] items-center gap-3 border-b border-[#dadde1] bg-[#f0f2f5] px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] uppercase tracking-[0.04em] text-[#65676b]">{brand.displayDomain}</p>
          <p className="mt-0.5 truncate text-[15px] font-semibold leading-tight">{headline}</p>
          <p className="mt-1 truncate text-[12px] text-[#65676b]">{description}</p>
        </div>
        <span className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-md bg-[#e4e6eb] px-4 text-[13px] font-semibold text-[#050505]">
          {formatCta(copy.cta)}
        </span>
      </div>

      <div className="px-3">
        <div className="grid min-h-10 grid-cols-3 text-[13px] font-semibold text-[#65676b]">
          <MetaAction icon={<ThumbsUp aria-hidden />} label="Like" />
          <MetaAction icon={<MessageCircle aria-hidden />} label="Comment" />
          <MetaAction icon={<Share2 aria-hidden />} label="Share" />
        </div>
      </div>
    </article>
  );
}

function MetaStoryPreview({ brand, copy, creative }: { brand: MetaPreviewBrand; copy: MetaCopy; creative: ReactNode }) {
  return (
    <article
      aria-label="Facebook Story ad preview"
      className="relative aspect-[9/16] h-full max-h-[860px] min-h-0 max-w-full overflow-hidden rounded-[18px] bg-black font-sans text-white shadow-[0_22px_65px_rgba(15,23,42,0.28)]"
    >
      <div className="absolute inset-0">{creative}</div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/60 via-black/20 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/65 via-black/25 to-transparent" />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 px-3 pt-2.5">
        <div className="flex items-center gap-2.5">
          <PageAvatar brand={brand} size="sm" />
          <div className="min-w-0 flex-1 text-[12px] leading-tight drop-shadow-sm">
            <p className="truncate font-semibold">{brand.businessName}</p>
            <p className="mt-0.5 text-white/80">Sponsored</p>
          </div>
          <MoreHorizontal aria-hidden className="size-5" />
        </div>
      </header>

      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-4 pb-5 text-center">
        <span className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-white px-4 text-[13px] font-semibold text-[#050505] shadow-lg">
          {formatCta(copy.cta)}
        </span>
      </footer>
    </article>
  );
}

function PageAvatar({ brand, size }: { brand: MetaPreviewBrand; size: "sm" | "md" }) {
  const dimension = size === "md" ? "size-10" : "size-8";
  const initials = brand.businessName
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "BW";
  return (
    <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded-full border border-black/10 bg-[#172a3a] text-[11px] font-bold text-white", dimension)}>
      {brand.logoUrl ? <img src={brand.logoUrl} alt="" className="size-full object-cover" /> : initials}
    </span>
  );
}

function MetaAction({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center justify-center gap-1.5 [&_svg]:size-4">
      {icon}
      {label}
    </span>
  );
}

export function formatCta(value: string): string {
  return labelForMetaCta(toMetaCta(value));
}
