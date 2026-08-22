// Meta placement truncation — best-known 2026 values.
//
// Meta publishes NO hard numbers for any of these; the values below are the
// best-known 2026 measurements (plan Appendix A). They live here — one file,
// commented — so drift is re-checkable in one place, and the
// generatepreviews side-by-side in meta-frame keeps them honest.

/** FB mobile feed primary text: ~125 chars / 3 lines before "See more". */
export const FB_FEED_PRIMARY_SEE_MORE_CHARS = 125;
export const FB_FEED_PRIMARY_SEE_MORE_LINES = 3;

/** FB feed headline: ~27 visible chars before ellipsis. */
export const FB_FEED_HEADLINE_VISIBLE_CHARS = 27;

/** Description only renders on Facebook placements, space permitting. */
export const DESC_FB_ONLY = true;

/** IG caption: ~125 chars before "… more". */
export const IG_CAPTION_MORE_CHARS = 125;

/** Story primary-text overlay: ~40 chars before folding. */
export const STORY_PRIMARY_OVERLAY_CHARS = 40;

export type MetaPrimaryText = {
  visible: string;
  truncated: boolean;
  /** The interactive tail Meta renders ("See more") when truncated. */
  suffix: string;
};

/**
 * How the FB feed renders primary text: the first 3 lines / ~125 chars, then
 * "See more". Ports formatMetaPrimaryText behaviour from
 * src/components/adstudio/preview.tsx (which returns a flat string); this
 * version returns the parts so the frame can render the real interaction.
 */
export function formatMetaPrimaryText(text: string): MetaPrimaryText {
  const normalised = text.replace(/\r\n?/g, "\n").trim();
  const lines = normalised.split("\n");
  const visibleLines = lines.slice(0, FB_FEED_PRIMARY_SEE_MORE_LINES);
  let visible = visibleLines.join("\n").trimEnd();
  let truncated =
    lines.length > FB_FEED_PRIMARY_SEE_MORE_LINES
    || normalised.length > FB_FEED_PRIMARY_SEE_MORE_CHARS;

  if (visible.length > FB_FEED_PRIMARY_SEE_MORE_CHARS) {
    visible = visible.slice(0, FB_FEED_PRIMARY_SEE_MORE_CHARS).trimEnd();
    truncated = true;
  }

  return { visible, truncated, suffix: truncated ? "See more" : "" };
}

/** Headline: ~27 chars then a single-character ellipsis. */
export function truncateHeadline(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= FB_FEED_HEADLINE_VISIBLE_CHARS) return trimmed;
  return `${trimmed.slice(0, FB_FEED_HEADLINE_VISIBLE_CHARS).trimEnd()}…`;
}

/** IG caption: ~125 chars then "… more" (tappable, not a button). */
export function truncateIgCaption(text: string): { visible: string; truncated: boolean } {
  const normalised = text.replace(/\r\n?/g, "\n").trim();
  if (normalised.length <= IG_CAPTION_MORE_CHARS) {
    return { visible: normalised, truncated: false };
  }
  return {
    visible: `${normalised.slice(0, IG_CAPTION_MORE_CHARS).trimEnd()}…`,
    truncated: true,
  };
}

/** Story overlay primary text: ~40 chars before Meta folds it. */
export function truncateStoryPrimary(text: string): { visible: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= STORY_PRIMARY_OVERLAY_CHARS) {
    return { visible: trimmed, truncated: false };
  }
  return {
    visible: `${trimmed.slice(0, STORY_PRIMARY_OVERLAY_CHARS).trimEnd()}…`,
    truncated: true,
  };
}
