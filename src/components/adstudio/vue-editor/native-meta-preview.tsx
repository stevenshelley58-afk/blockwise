"use client";

import { ArrowUp, MessageCircle, MoreHorizontal, Share2, ThumbsUp } from "lucide-react";
import { BusinessAvatar } from "../editor/meta-previews";
import { ctaLabelText, domainLabel, truncateForPreview } from "../editor/preview-text";
import { META_COPY_CONSTRAINTS } from "@/lib/adstudio/meta-copy-contract";

export type NativeMetaCopy = { primaryText: string; headline: string; description: string; cta: string };
type Props = { placement: "feed" | "story"; image: string | null; copy: NativeMetaCopy; businessName: string; logoUrl: string | null; destinationUrl?: string };

/** Meta chrome around the editor's own latest PNG, never a re-rendered legacy layout. */
export function NativeMetaPreview({ placement, image, copy, businessName, logoUrl, destinationUrl }: Props) {
  if (placement === "story") return <Story image={image} copy={copy} businessName={businessName} logoUrl={logoUrl} />;
  const primary = truncateForPreview(copy.primaryText, META_COPY_CONSTRAINTS.primaryText);
  const headline = truncateForPreview(copy.headline, META_COPY_CONSTRAINTS.headline);
  const description = truncateForPreview(copy.description, META_COPY_CONSTRAINTS.description);
  const cta = truncateForPreview(ctaLabelText(copy.cta), META_COPY_CONSTRAINTS.cta) || "Learn more";
  return <div className="mx-auto w-full max-w-[390px] overflow-hidden rounded-(--r-card) border border-border bg-card shadow-card" data-testid="vue-meta-feed-preview">
    <div className="flex items-center gap-2.5 px-4 py-3">
      <BusinessAvatar businessName={businessName} logoUrl={logoUrl} />
      <div className="min-w-0 flex-1 leading-tight"><p className="truncate text-[13px] font-semibold">{businessName || "Your business"}</p><p className="text-[11px] text-muted-foreground">Sponsored</p></div>
      <MoreHorizontal className="size-5 text-muted-foreground" aria-label="More options" />
    </div>
    <p className="px-4 pb-3 text-[13px] leading-relaxed">{primary || "Your primary text appears here."}</p>
    <Creative image={image} ratio="aspect-[4/5]" label="Feed creative preview" />
    <div className="flex items-stretch justify-between gap-3 border-t border-border bg-muted/50 px-4 py-3">
      <div className="min-w-0 flex-1"><p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{domainLabel(destinationUrl) || "Destination not set"}</p><p className="mt-0.5 truncate text-[14px] font-semibold">{headline || "Your headline"}</p>{description ? <p className="truncate text-[12px] text-muted-foreground">{description}</p> : null}</div>
      <span className="flex shrink-0 items-center rounded-md border border-border bg-card px-3 text-[13px] font-medium">{cta}</span>
    </div>
    <div className="flex items-center justify-around border-t border-border px-3 py-2 text-[12px] font-medium text-muted-foreground" aria-label="Post actions"><span className="inline-flex items-center gap-1"><ThumbsUp className="size-4" />Like</span><span className="inline-flex items-center gap-1"><MessageCircle className="size-4" />Comment</span><span className="inline-flex items-center gap-1"><Share2 className="size-4" />Share</span></div>
  </div>;
}

function Story({ image, copy, businessName, logoUrl }: Omit<Props, "placement" | "destinationUrl">) {
  return <div className="relative mx-auto aspect-[9/16] w-full max-w-[280px] overflow-hidden rounded-(--r-card) bg-card shadow-card" data-testid="vue-meta-story-preview">
    <Creative image={image} ratio="absolute inset-0" label="Story creative preview" />
    <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/45 to-transparent px-3 pb-8 pt-2">
      <div className="mb-2 flex gap-1" aria-hidden>{[0, 1, 2, 3].map(bar => <span key={bar} className={`h-0.5 flex-1 rounded-full ${bar === 0 ? "bg-white" : "bg-white/40"}`} />)}</div>
      <div className="flex items-center gap-2"><BusinessAvatar businessName={businessName} logoUrl={logoUrl} size={28} /><p className="truncate text-[12px] font-semibold text-white drop-shadow">{businessName || "Your business"}</p><p className="text-[12px] text-white/80 drop-shadow">Sponsored</p></div>
    </div>
    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-3 pb-4 pt-10"><div className="flex items-center justify-between gap-2"><span className="max-w-[70%] truncate rounded-full bg-white/95 px-4 py-2 text-[12px] font-semibold text-neutral-900 shadow">{truncateForPreview(ctaLabelText(copy.cta), META_COPY_CONSTRAINTS.cta) || "Learn more"}</span><ArrowUp className="size-4 text-white/90" /></div></div>
  </div>;
}

function Creative({ image, ratio, label }: { image: string | null; ratio: string; label: string }) {
  return <div className={`${ratio} grid w-full place-items-center overflow-hidden bg-muted`}>
    {image ? <img src={image} alt={label} className="size-full object-cover" /> : <p className="px-5 text-center text-xs text-muted-foreground">Preview appears after the editor finishes rendering.</p>}
  </div>;
}
