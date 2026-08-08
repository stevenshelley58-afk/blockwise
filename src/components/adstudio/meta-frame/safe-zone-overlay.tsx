"use client";

// Meta story safe zones (plan §8 / Appendix A). Top ~250px and bottom ~340px
// on 9:16 stories; Reels adds a ~672px bottom clearance. Shown by default in
// Studio, on demand for customers. Values are design guidance, not contract —
// the generatepreviews side-by-side is what keeps them honest.

export const STORY_SAFE_TOP_PX = 250;
export const STORY_SAFE_BOTTOM_PX = 340;
export const REELS_BOTTOM_CLEARANCE_PX = 672;

export type SafeZoneSurface = "story" | "reels";

export function SafeZoneOverlay({ surface }: { surface: SafeZoneSurface }) {
  // Bands are percentages of the 1920px story canvas, so the overlay stays
  // proportionally correct at ANY rendered size (harness CSS scale included).
  const topPct = (STORY_SAFE_TOP_PX / 1920) * 100;
  const bottomStoryPct = (STORY_SAFE_BOTTOM_PX / 1920) * 100;
  const bottomReelsPct = (REELS_BOTTOM_CLEARANCE_PX / 1920) * 100;

  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      <div
        className="absolute inset-x-0 top-0 border-b-2 border-dashed border-[#ff5f5f]/80 bg-[#ff5f5f]/10"
        style={{ height: `${topPct}%` }}
      >
        <span className="absolute bottom-1 left-2 text-[11px] font-bold uppercase tracking-wide text-[#ff5f5f]">
          keep clear · {STORY_SAFE_TOP_PX}px
        </span>
      </div>
      <div
        className="absolute inset-x-0 bottom-0 border-t-2 border-dashed border-[#ff5f5f]/80 bg-[#ff5f5f]/10"
        style={{ height: `${bottomStoryPct}%` }}
      >
        <span className="absolute top-1 left-2 text-[11px] font-bold uppercase tracking-wide text-[#ff5f5f]">
          keep clear · {STORY_SAFE_BOTTOM_PX}px
        </span>
      </div>
      {surface === "reels" ? (
        <div
          className="absolute inset-x-0 bottom-0 border-t-2 border-dashed border-[#ffb020]/90 bg-[#ffb020]/10"
          style={{ height: `${bottomReelsPct}%` }}
        >
          <span className="absolute top-1 right-2 text-[11px] font-bold uppercase tracking-wide text-[#ffb020]">
            Reels clearance · {REELS_BOTTOM_CLEARANCE_PX}px
          </span>
        </div>
      ) : null}
    </div>
  );
}
