"use client";

// Facebook mobile feed placement (plan §8): 40px avatar, page name,
// "Sponsored ·", ellipsis; primary text with real truncation + interactive
// "See more"; media; link area (domain, headline, description) and the CTA
// button with the real enum label; Like/Comment/Share row.

import { MessageCircle, MoreHorizontal, Share2, ThumbsUp } from "lucide-react";

import { resolveAdvertiserDomain } from "@/lib/adstudio/advertiser-domain";
import { formatMetaPrimaryText, truncateHeadline } from "@/lib/adstudio/v2/render/truncate.ts";

import { MetaFrameAvatar, MetaFrameCopyButton, metaPageName, type MetaFrameCommonProps } from "./frame-bits";

export function FbFeedMobileFrame(props: MetaFrameCommonProps) {
  const { brandKit, copy, destinationUrl, children, onSelectText, selectedElement } = props;
  const pageName = metaPageName(brandKit);
  const domain = resolveAdvertiserDomain({ brandKit, finalUrls: [destinationUrl] });
  const primary = formatMetaPrimaryText(copy.primaryText);

  return (
    <div className="mx-auto w-full max-w-[430px] font-[system-ui,-apple-system,BlinkMacSystemFont,'Segoe_UI',Helvetica,Arial,sans-serif]">
      <article className="bg-white text-[#050505]">
        <header className="flex h-16 items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <MetaFrameAvatar brandKit={brandKit} />
            <div className="min-w-0">
              <strong className="block truncate text-[15px] font-bold leading-tight text-[#050505]">{pageName}</strong>
              <small className="block text-[13px] leading-tight text-[#65676b]">Sponsored ·</small>
            </div>
          </div>
          <MoreHorizontal aria-hidden size={18} className="text-[#65676b]" />
        </header>

        <MetaFrameCopyButton
          element="primaryText"
          selectedElement={selectedElement}
          onSelectText={onSelectText}
          className="block w-full whitespace-pre-line px-4 pb-3 text-[15px] leading-[1.333] text-[#050505]"
        >
          {primary.visible}
          {primary.truncated ? (
            <span className="text-[#65676b]">... {primary.suffix}</span>
          ) : null}
        </MetaFrameCopyButton>

        <div className="relative min-h-[120px] bg-[#eee]">{children}</div>

        <footer className="grid min-h-[76px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-[#dadde1] bg-[#f0f2f5] px-4 py-2.5">
          <div className="min-w-0">
            <small className="block text-[12px] font-semibold uppercase leading-tight text-[#65676b]">
              {domain.host}
            </small>
            <MetaFrameCopyButton
              element="headline"
              selectedElement={selectedElement}
              onSelectText={onSelectText}
              className="mt-1 block w-full truncate text-[16px] font-semibold leading-[1.22] text-[#050505]"
            >
              {truncateHeadline(copy.headline)}
            </MetaFrameCopyButton>
            <MetaFrameCopyButton
              element="description"
              selectedElement={selectedElement}
              onSelectText={onSelectText}
              className="mt-0.5 block w-full truncate text-[13px] leading-[1.25] text-[#65676b]"
            >
              {copy.description}
            </MetaFrameCopyButton>
          </div>
          <MetaFrameCopyButton
            element="cta"
            selectedElement={selectedElement}
            onSelectText={onSelectText}
            className="inline-flex min-h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-[#e4e6eb] px-3.5 text-[15px] font-semibold text-[#050505]"
          >
            {copy.cta}
          </MetaFrameCopyButton>
        </footer>

        <div className="flex items-center justify-around border-t border-[#dadde1] px-2 py-1 text-[#65676b]">
          <span className="inline-flex items-center gap-1.5 py-2 text-[14px] font-semibold">
            <ThumbsUp aria-hidden size={17} /> Like
          </span>
          <span className="inline-flex items-center gap-1.5 py-2 text-[14px] font-semibold">
            <MessageCircle aria-hidden size={17} /> Comment
          </span>
          <span className="inline-flex items-center gap-1.5 py-2 text-[14px] font-semibold">
            <Share2 aria-hidden size={17} /> Share
          </span>
        </div>
      </article>
      {domain.setupNudge ? <p className="mt-2.5 text-[12px] font-semibold text-[#d7deea]">{domain.setupNudge}</p> : null}
    </div>
  );
}
