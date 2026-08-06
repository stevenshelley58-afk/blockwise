"use client";

// Instagram feed placement: IG header (avatar, username, Sponsored),
// full-bleed media, blue CTA bar, action row, caption with "… more".

import { Bookmark, ChevronRight, Heart, MessageCircle, Send } from "lucide-react";

import { truncateIgCaption } from "@/lib/adstudio/v2/render/truncate.ts";

import { MetaFrameAvatar, MetaFrameCopyButton, metaPageName, type MetaFrameCommonProps } from "./frame-bits";

export function IgFeedFrame(props: MetaFrameCommonProps) {
  const { brandKit, copy, children, onSelectText, selectedElement } = props;
  const username = metaPageName(brandKit).toLowerCase().replace(/\s+/g, ".");
  const caption = truncateIgCaption(`${username} ${copy.primaryText}`);

  return (
    <div className="w-full bg-white font-[system-ui,-apple-system,BlinkMacSystemFont,'Segoe_UI',Helvetica,Arial,sans-serif] text-[#262626]">
      <header className="flex h-14 items-center gap-2.5 px-3">
        <MetaFrameAvatar brandKit={brandKit} size={32} />
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-[14px] font-semibold leading-tight">{username}</strong>
          <small className="block text-[12px] leading-tight text-[#8e8e8e]">Sponsored</small>
        </div>
      </header>

      <div className="relative aspect-square w-full bg-[#efefef]">{children}</div>

      <div className="flex items-center gap-4 px-3 py-2.5">
        <Heart aria-hidden size={24} />
        <MessageCircle aria-hidden size={24} />
        <Send aria-hidden size={24} />
        <Bookmark aria-hidden size={24} className="ml-auto" />
      </div>

      <div className="px-3 pb-3">
        <MetaFrameCopyButton
          element="primaryText"
          selectedElement={selectedElement}
          onSelectText={onSelectText}
          className="block w-full text-[14px] leading-snug text-[#262626]"
        >
          <strong className="font-semibold">{username}</strong>{" "}
          {caption.visible}
          {caption.truncated ? <span className="text-[#8e8e8e]"> more</span> : null}
        </MetaFrameCopyButton>
      </div>

      <button
        type="button"
        onClick={() => onSelectText?.("cta")}
        className="flex w-full items-center justify-between border-t border-[#dbdbdb] px-3 py-3 text-[14px] font-semibold text-[#0095f6]"
      >
        {copy.cta}
        <ChevronRight aria-hidden size={16} />
      </button>
    </div>
  );
}
