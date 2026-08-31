// ---------------------------------------------------------------------------
// Preview text helpers — pure functions used by the Meta Feed and Story
// previews. Kept out of the TSX component so they are directly testable.
// ---------------------------------------------------------------------------

/** Collapse whitespace and truncate the way Meta collapses long copy. */
export function truncateForPreview(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max).replace(/\s+\S*$/u, "")}…`;
}

/** Human CTA label from the stored Meta CTA value ("LEARN_MORE" → "Learn more"). */
export function ctaLabelText(cta: string): string {
  if (!cta.trim()) return "Learn more";
  return cta.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/** Destination domain shown in the Feed link row ("" when not a valid URL). */
export function domainLabel(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Fallback avatar initials from the business name ("Summit Realty" → "SR"). */
export function businessInitials(businessName: string): string {
  const initials = (businessName.trim() || "B")
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "B";
}
