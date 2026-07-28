"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { displayDomain, MetaAdLibraryCard } from "@/components/research/meta-ad-library-card";
import { formatLabel, MetaAdTile, runLabel } from "@/components/research/meta-ad-tile";
import { CreativeViewer, type CreativeViewerItem } from "@/components/ui/creative-viewer";
import type { CustomerMetaAdLibraryCard } from "@/lib/research/customer-meta-card";

const BATCH_SIZE = 48;
const MASONRY_ROW_HEIGHT = 8;
const MASONRY_GAP = 16;

/**
 * Renders the full result set with incremental (lazy) rendering: the first
 * batch paints immediately and the rest stream in as the user scrolls, so
 * there is no hard cap on how many ads are reachable.
 */
export function AdRadarResultsGrid({ cards }: { cards: CustomerMetaAdLibraryCard[] }) {
  const [visibleCount, setVisibleCount] = useState(Math.min(BATCH_SIZE, cards.length));
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const isDesktop = useIsDesktop();

  // Reset when a new search/sort result set arrives.
  useEffect(() => {
    setVisibleCount(Math.min(BATCH_SIZE, cards.length));
    setViewerIndex(null);
  }, [cards]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= cards.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((current) => Math.min(current + BATCH_SIZE, cards.length));
        }
      },
      { rootMargin: "1200px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [cards.length, visibleCount]);

  const visibleCards = cards.slice(0, visibleCount);
  const remaining = cards.length - visibleCount;
  const viewerItems = useMemo(() => visibleCards.map(toViewerItem), [visibleCards]);
  const openViewerAt = useCallback((cardIndex: number) => setViewerIndex(cardIndex), []);

  return (
    <>
      {isDesktop ? (
        <div className="grid items-start gap-4 [grid-auto-rows:8px] [grid-template-columns:repeat(auto-fill,minmax(min(100%,360px),1fr))]">
          {visibleCards.map((card) => (
            <MasonryItem key={card.id}>
              <MetaAdLibraryCard card={card} />
            </MasonryItem>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 items-start gap-3">
          {visibleCards.map((card, cardIndex) => (
            <MetaAdTile key={card.id} card={card} onOpen={() => openViewerAt(cardIndex)} />
          ))}
        </div>
      )}

      <CreativeViewer
        open={viewerIndex !== null}
        onOpenChange={(next) => setViewerIndex(next ? (viewerIndex ?? 0) : null)}
        items={viewerItems}
        index={viewerIndex ?? 0}
        onIndexChange={setViewerIndex}
        secondaryAction={
          viewerIndex !== null && visibleCards[viewerIndex]?.libraryId
            ? {
                label: "Open in Meta",
                href: `https://www.facebook.com/ads/library/?id=${encodeURIComponent(
                  visibleCards[viewerIndex].libraryId as string,
                )}`,
              }
            : undefined
        }
        primaryAction={
          viewerIndex !== null
            ? { label: "View details", href: `/ad-radar/ads/${visibleCards[viewerIndex]?.id ?? ""}` }
            : undefined
        }
      />
      {remaining > 0 ? (
        <div ref={sentinelRef} className="flex justify-center pt-2 pb-1">
          <button
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-(--line-heavy) bg-card px-3.5 text-[12.5px] font-bold text-foreground transition-[background,box-shadow] duration-150 hover:bg-(--surface-subtle) hover:shadow-card"
            type="button"
            onClick={() => setVisibleCount((current) => Math.min(current + BATCH_SIZE, cards.length))}
          >
            Show more ({remaining} remaining)
          </button>
        </div>
      ) : null}
    </>
  );
}

function MasonryItem({ children }: { children: ReactNode }) {
  const itemRef = useRef<HTMLDivElement | null>(null);
  const [rowSpan, setRowSpan] = useState(1);

  useLayoutEffect(() => {
    const item = itemRef.current;
    if (!item) return;

    function updateRowSpan() {
      const height = item?.getBoundingClientRect().height ?? 0;
      const nextRowSpan = Math.max(1, Math.ceil((height + MASONRY_GAP) / (MASONRY_ROW_HEIGHT + MASONRY_GAP)));
      setRowSpan((current) => (current === nextRowSpan ? current : nextRowSpan));
    }

    updateRowSpan();
    const observer = new ResizeObserver(updateRowSpan);
    observer.observe(item);

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={itemRef} style={{ gridRowEnd: `span ${rowSpan}` }}>
      {children}
    </div>
  );
}

/** True at >=640px. False on the server and on first paint (mobile-first). */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 640px)");
    const sync = () => setIsDesktop(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return isDesktop;
}

function toViewerItem(card: CustomerMetaAdLibraryCard): CreativeViewerItem {
  const statusLabel =
    card.activeStatus === "inactive" ? "Inactive" : card.activeStatus === "active" ? "Active" : "Unknown";
  const subtitle = [statusLabel, runLabel(card.startedAt, card.stoppedAt), formatLabel(card)]
    .filter(Boolean)
    .join(" · ");
  const footnote = [card.destinationUrl ? displayDomain(card.destinationUrl) : null, card.headline]
    .filter(Boolean)
    .join(" · ");

  return {
    id: card.id,
    media: card.media[0]
      ? { kind: card.media[0].kind, url: card.media[0].url, posterUrl: card.media[0].posterUrl }
      : null,
    title: card.pageName,
    subtitle,
    body: card.body,
    footnote: footnote || null,
  };
}
