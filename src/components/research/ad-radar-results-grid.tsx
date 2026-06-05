"use client";

import { useEffect, useRef, useState } from "react";

import { MetaAdLibraryCard } from "@/components/research/meta-ad-library-card";
import type { CustomerMetaAdLibraryCard } from "@/lib/research/customer-meta-card";

const BATCH_SIZE = 48;

/**
 * Renders the full result set with incremental (lazy) rendering: the first
 * batch paints immediately and the rest stream in as the user scrolls, so
 * there is no hard cap on how many ads are reachable.
 */
export function AdRadarResultsGrid({ cards }: { cards: CustomerMetaAdLibraryCard[] }) {
  const [visibleCount, setVisibleCount] = useState(Math.min(BATCH_SIZE, cards.length));
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset when a new search/sort result set arrives.
  useEffect(() => {
    setVisibleCount(Math.min(BATCH_SIZE, cards.length));
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

  return (
    <>
      <div className="research-results-grid">
        {visibleCards.map((card) => (
          <MetaAdLibraryCard card={card} key={card.id} />
        ))}
      </div>
      {remaining > 0 ? (
        <div ref={sentinelRef} style={{ display: "flex", justifyContent: "center", padding: "8px 0 4px" }}>
          <button
            className="button secondary"
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
