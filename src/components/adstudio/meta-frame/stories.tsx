"use client";

// Vertical story placements (IG story / FB story) and IG Reels. All are 9:16
// with the chrome as a pointer-events-none overlay so the creative (or its
// editor) underneath stays interactive. Safe-zone overlays slot on top.

import { ChevronRight, Heart, MessageCircle, MoreHorizontal, Send } from "lucide-react";

import { truncateStoryPrimary } from "@/lib/adstudio/v2/render/truncate.ts";

import { MetaFrameAvatar, MetaFrameCopyButton, metaPageName, type MetaFrameCommonProps } from "./frame-bits";

function StoryProgressBars() {
  return (
    <span aria-hidden className="absolute left-3 right-3 top-2.5 flex gap-1">
      <i className="h-[2.5px] flex-1 rounded-full bg-white" />
      <i className="h-[2.5px] flex-1 rounded-full bg-white/45" />
      <i className="h-[2.5px] flex-1 rounded-full bg-white/45" />
    </span>
  );
}

function StoryBrandRow({ props }: { props: MetaFrameCommonProps }) {
  const pageName = metaPageName(props.brandKit);
  return (
    <div className="absolute left-3.5 right-3.5 top-6 flex items-center gap-2">
      <MetaFrameAvatar brandKit={props.brandKit} size={32} dark />
      <div className="min-w-0">
        <strong className="block truncate text-[13px] font-bold text-white">{pageName}</strong>
        <small className="block text-[11px] text-white/90">Sponsored</small>
      </div>
    </div>
  );
}

function StoryScrims() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          "linear-gradient(180deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0) 20%, rgba(0,0,0,0) 78%, rgba(0,0,0,0.45) 100%)",
      }}
    />
  );
}

export function IgStoryFrame(props: MetaFrameCommonProps) {
  const { copy, onSelectText } = props;
  const overlay = truncateStoryPrimary(copy.primaryText);

  return (
    <div className="relative aspect-[9/16] w-[min(360px,82vw)] overflow-hidden bg-black font-[system-ui,-apple-system,BlinkMacSystemFont,'Segoe_UI',Helvetica,Arial,sans-serif]">
      <div className="absolute inset-0">{props.children}</div>
      <div className="pointer-events-none absolute inset-0 z-10 text-white">
        <StoryScrims />
        <StoryProgressBars />
        <StoryBrandRow props={props} />
        <MetaFrameCopyButton
          element="primaryText"
          selectedElement={props.selectedElement}
          onSelectText={onSelectText}
          className="pointer-events-auto absolute bottom-[19%] left-4 right-4 text-center text-[15px] font-medium"
        >
          {overlay.visible}
        </MetaFrameCopyButton>
        <span className="absolute bottom-7 left-1/2 inline-flex min-h-[34px] -translate-x-1/2 items-center rounded-full bg-white/[.92] px-4 text-[13px] font-bold text-[#050505]">
          {copy.cta}
          <ChevronRight aria-hidden size={15} />
        </span>
      </div>
    </div>
  );
}

export function FbStoryFrame(props: MetaFrameCommonProps) {
  const { copy } = props;
  return (
    <div className="relative aspect-[9/16] w-[min(360px,82vw)] overflow-hidden bg-black font-[system-ui,-apple-system,BlinkMacSystemFont,'Segoe_UI',Helvetica,Arial,sans-serif]">
      <div className="absolute inset-0">{props.children}</div>
      <div className="pointer-events-none absolute inset-0 z-10 text-white">
        <StoryScrims />
        <StoryProgressBars />
        <StoryBrandRow props={props} />
        <span className="absolute bottom-7 left-1/2 inline-flex min-h-[34px] -translate-x-1/2 items-center rounded-full bg-white/[.92] px-4 text-[13px] font-bold text-[#050505]">
          {copy.cta}
          <ChevronRight aria-hidden size={15} />
        </span>
      </div>
    </div>
  );
}

export function IgReelsFrame(props: MetaFrameCommonProps) {
  const { copy } = props;
  const username = metaPageName(props.brandKit).toLowerCase().replace(/\s+/g, ".");

  return (
    <div className="relative aspect-[9/16] w-[min(360px,82vw)] overflow-hidden bg-black font-[system-ui,-apple-system,BlinkMacSystemFont,'Segoe_UI',Helvetica,Arial,sans-serif] text-white">
      <div className="absolute inset-0">{props.children}</div>
      <div className="pointer-events-none absolute inset-0 z-10">
        <StoryScrims />
        <div className="absolute left-3 right-3 top-3 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <MetaFrameAvatar brandKit={props.brandKit} size={32} dark />
            <strong className="truncate text-[13px] font-bold">{username}</strong>
            <small className="text-[11px] text-white/80">Sponsored</small>
          </div>
          <MoreHorizontal aria-hidden size={18} />
        </div>

        {/* Right-side engagement rail */}
        <div className="absolute bottom-[24%] right-2.5 flex flex-col items-center gap-5">
          <span className="flex flex-col items-center gap-1"><Heart aria-hidden size={26} /><small className="text-[11px]">Like</small></span>
          <span className="flex flex-col items-center gap-1"><MessageCircle aria-hidden size={26} /><small className="text-[11px]">Comment</small></span>
          <span className="flex flex-col items-center gap-1"><Send aria-hidden size={26} /><small className="text-[11px]">Share</small></span>
        </div>

        {/* Bottom caption + CTA with the Reels clearance visualized */}
        <div className="absolute bottom-0 left-0 right-0 px-3 pb-4">
          <p className="mb-2 text-[13px] leading-snug">{username} {copy.primaryText}</p>
          <span className="inline-flex min-h-[34px] items-center rounded-full bg-white/[.92] px-4 text-[13px] font-bold text-[#050505]">
            {copy.cta}
            <ChevronRight aria-hidden size={15} />
          </span>
        </div>
      </div>
    </div>
  );
}
