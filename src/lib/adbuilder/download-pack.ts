import { sanitizeDownloadFilename } from "./media-download.ts";
import { labelForMetaCta } from "./meta-cta.ts";

// ---------------------------------------------------------------------------
// No-card download pack.
//
// The customer can always take the ad they made and run it themselves in their
// own Meta ad account. This module is the single source of truth for the pack's
// file names and for the copy sheet, so the API route and the screens that link
// to it can never drift apart.
//
// Nothing here touches billing, Meta connections or subscriptions. It is pure
// formatting over data the customer already owns.
// ---------------------------------------------------------------------------

export type DownloadPlacement = "feed" | "story";

/** Every saved ad pack renders both placements. Sizes are the render contract. */
export const DOWNLOAD_PLACEMENTS: ReadonlyArray<{
  placement: DownloadPlacement;
  label: string;
  width: number;
  height: number;
}> = [
  { placement: "feed", label: "Feed", width: 1080, height: 1350 },
  { placement: "story", label: "Story", width: 1080, height: 1920 },
];

export const DEFAULT_EXPORT_TIME_ZONE = "Australia/Perth";

/**
 * An ad name is customer text. A blank or punctuation-only name would otherwise
 * become a file called "-feed.png", so fall back to the product name instead.
 */
function usableAdName(adName: string): boolean {
  return /[a-zA-Z0-9]/.test(adName);
}

/** The artwork file name a customer sees, matching the media route download. */
export function artworkFileName(adName: string, placement: DownloadPlacement): string {
  const fallback = `blockwise-ad-${placement}.png`;
  return usableAdName(adName) ? sanitizeDownloadFilename(`${adName}-${placement}.png`, fallback) : fallback;
}

/** The copy sheet file name a customer sees. */
export function adCopyFileName(adName: string): string {
  const fallback = "blockwise-ad-copy.txt";
  return usableAdName(adName) ? sanitizeDownloadFilename(`${adName}-ad-copy.txt`, fallback) : fallback;
}

export type AdCopySheetInput = {
  adName: string;
  metaPrimaryText: string;
  metaHeadline: string;
  metaDescription: string;
  metaCta: string;
  destinationUrl?: string | null;
  /** True when a saved render exists, so the pack can name real files. */
  hasFeedArtwork: boolean;
  hasStoryArtwork: boolean;
  exportedAt: Date;
  timeZone?: string;
};

/**
 * A plain-text sheet a customer can read and paste from. Sections with no
 * content are omitted rather than emitted empty, so a half-filled ad still
 * produces a clean sheet.
 */
export function buildAdCopySheet(input: AdCopySheetInput): string {
  const blocks: string[] = [];
  blocks.push("Blockwise ad export");
  blocks.push("");
  blocks.push(`Ad: ${oneLine(input.adName) || "Untitled ad"}`);
  blocks.push(`Exported: ${formatExportTime(input.exportedAt, input.timeZone)}`);

  const files = DOWNLOAD_PLACEMENTS.flatMap((entry) => {
    const saved = entry.placement === "feed" ? input.hasFeedArtwork : input.hasStoryArtwork;
    if (!saved) return [];
    return [`${entry.label} image: ${artworkFileName(input.adName, entry.placement)} (${entry.width} x ${entry.height})`];
  });
  if (files.length > 0) {
    blocks.push("");
    blocks.push("Creative files");
    blocks.push(...files);
  }

  const copy = [
    section("Primary text", input.metaPrimaryText),
    section("Headline", input.metaHeadline),
    section("Description", input.metaDescription),
    section("Call to action button", labelForMetaCta(input.metaCta)),
    section("Website URL", input.destinationUrl ?? ""),
  ].filter((value): value is string => Boolean(value));

  if (copy.length > 0) {
    blocks.push("");
    blocks.push("Ad copy");
    blocks.push("");
    blocks.push(copy.join("\n\n"));
  }

  blocks.push("");
  blocks.push("Running this ad yourself");
  blocks.push(
    "Add the creative above to Meta Ads Manager, paste the matching text into your ad, and choose the call to action button listed here. Meta charges ad spend directly to your own payment method.",
  );

  return `${blocks.join("\n")}\n`;
}

function section(heading: string, value: string): string | null {
  const text = value.trim();
  return text ? `${heading}\n${text}` : null;
}

function oneLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function formatExportTime(exportedAt: Date, timeZone?: string): string {
  const resolved = resolveExportTimeZone(timeZone);
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: resolved,
  }).format(exportedAt);
}

/** An unusable time zone must not break an export. Fall back and carry on. */
export function resolveExportTimeZone(value?: string | null): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) return DEFAULT_EXPORT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return DEFAULT_EXPORT_TIME_ZONE;
  }
}
