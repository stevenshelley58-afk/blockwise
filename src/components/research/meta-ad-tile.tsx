"use client";

import { Play } from "lucide-react";

import { STATUS_TONE, STATUS_TONE_UNKNOWN } from "@/components/research/meta-ad-library-card";

/*
 * Compact Ad Radar result tile — the mobile (<640px) counterpart to
 * MetaAdLibraryCard. Two per row, so it carries only what identifies an ad:
 * media, status, advertiser, a two-line headline and one meta line. Everything
 * else (body copy, link preview, CTA, platforms, library id, swipe-file action)
 * lives in the fullscreen viewer a tap opens.
 *
 * Tiles never mount a <video>: a grid of video elements is a mobile
 * performance trap. Video ads render their poster with a play badge.
 */

/**
 * What a tile draws. Ad Radar hands it a whole card; Home hands it the slim row
 * it read from the same data, so the tile asks for the fields it actually uses
 * rather than the whole record.
 */
export type AdTileCard = {
  id: string;
  pageName: string;
  headline: string | null;
  body?: string | null;
  media: Array<{ kind: string; url: string; posterUrl: string | null }>;
  activeStatus: string;
  startedAt: string | null;
  stoppedAt: string | null;
  adType?: string | null;
};

export function MetaAdTile({
  card,
  onOpen,
  href,
  thumbnailUrl,
}: {
  card: AdTileCard;
  /** Opens the fullscreen viewer. Ad Radar's grid uses this. */
  onOpen?: () => void;
  /** Navigates instead, for a surface that has a destination rather than a viewer. */
  href?: string;
  /** A still the caller resolved and checked, preferred over the card's own first media. */
  thumbnailUrl?: string;
}) {
  const statusTone = STATUS_TONE[card.activeStatus] ?? STATUS_TONE_UNKNOWN;
  const statusLabel =
    card.activeStatus === "inactive" ? "Inactive" : card.activeStatus === "active" ? "Active" : "Unknown";
  const media = card.media[0] ?? null;
  const thumbnail =
    thumbnailUrl ?? (media ? (media.kind === "video" ? (media.posterUrl ?? media.url) : media.url) : null);
  const title = card.headline?.trim() || card.body?.trim() || card.pageName;
  const className =
    "grid w-full min-w-0 cursor-pointer grid-rows-[auto_1fr] overflow-hidden rounded-(--r-card) border border-(--line) bg-(--surface) text-left shadow-card transition-[box-shadow,transform] duration-150 active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100";
  const content = (
    <>
      <span className="relative block aspect-4/5 w-full overflow-hidden bg-(--surface-subtle)">
        {thumbnail ? (
          // Meta CDN URLs are short-lived signed links; next/image would break them.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center px-3 text-center text-[11.5px] font-bold text-muted-foreground">
            {card.adType?.toLowerCase().includes("text") ? "Text-only ad" : "Preview unavailable"}
          </span>
        )}

        <span className="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-(--surface)/92 px-2 py-0.5 text-[10.5px] font-bold backdrop-blur-sm">
          <span className={`size-2 rounded-full ${statusTone.dot}`} aria-hidden />
          <span className={statusTone.label}>{statusLabel}</span>
        </span>

        {media?.kind === "video" ? (
          <span
            className="absolute right-2 bottom-2 grid size-6 place-items-center rounded-full bg-(--ink)/75 text-white"
            aria-hidden
          >
            <Play size={12} />
          </span>
        ) : null}
      </span>

      <span className="grid content-start gap-[3px] px-2.5 pt-2 pb-2.5">
        <span className="truncate text-[11.5px] font-semibold text-muted-foreground">{card.pageName}</span>
        <span className="line-clamp-2 text-[12.5px] leading-[1.32] font-bold text-foreground">{title}</span>
        <span className="text-[10.5px] text-(--faint)">{metaLine(card)}</span>
      </span>
    </>
  );

  if (href) {
    return (
      <a href={href} aria-label={`Open ${card.pageName} ad`} className={className}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" onClick={onOpen} aria-label={`Open ${card.pageName} ad`} className={className}>
      {content}
    </button>
  );
}

/** "Running 34 days · Video" — duration plus creative format. */
export function metaLine(card: AdTileCard): string {
  const parts = [runLabel(card.startedAt, card.stoppedAt), formatLabel(card)].filter(Boolean);
  return parts.join(" · ");
}

export function runLabel(startedAt: string | null, stoppedAt: string | null): string {
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (!Number.isFinite(started)) return stoppedAt ? "Stopped" : "";

  const end = stoppedAt ? Date.parse(stoppedAt) : Date.now();
  if (!Number.isFinite(end)) return "";

  const days = Math.max(1, Math.round((end - started) / 86_400_000));
  const unit = days === 1 ? "day" : "days";
  return stoppedAt ? `Ran ${days} ${unit}` : `Running ${days} ${unit}`;
}

export function formatLabel(card: AdTileCard): string {
  if (card.media.length === 0) return "Text only";
  if (card.media.length > 1) return "Carousel";
  return card.media[0].kind === "video" ? "Video" : "Image";
}
