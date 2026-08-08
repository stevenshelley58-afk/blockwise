// The ONE source of truth for Meta lead-ad CTA buttons.
//
// Three divergent label→enum keyword maps used to live in use-copy.ts,
// readiness.ts, and generator.ts — a CTA could map to different buttons
// depending on which code path touched it. This module replaces all three.
//
// The enum below is Meta's DOCUMENTED lead-ads subset (verified 2026-08-04,
// Appendix A of the AdStudio v2 rebuild plan). CONTACT_US is not in that
// subset — legacy packs carrying it are remapped to LEARN_MORE at payload
// build time with a logged warning; never sent to Meta.

export const META_LEAD_CTA_VALUES = [
  "LEARN_MORE",
  "SIGN_UP",
  "GET_QUOTE",
  "APPLY_NOW",
  "DOWNLOAD",
  "SUBSCRIBE",
] as const;

export type MetaLeadCta = (typeof META_LEAD_CTA_VALUES)[number];

/** Same list under the historical name; imports keep compiling. */
export const META_CTA_VALUES = META_LEAD_CTA_VALUES;
export type MetaCta = MetaLeadCta;

export const META_CTA_LABELS: Record<MetaLeadCta, string> = {
  LEARN_MORE: "Learn more",
  SIGN_UP: "Sign up",
  GET_QUOTE: "Get quote",
  APPLY_NOW: "Apply now",
  DOWNLOAD: "Download",
  SUBSCRIBE: "Subscribe",
};

const LEGACY_CONTACT_US_LABEL = "Contact us";

export function isMetaCta(value: string): value is MetaLeadCta {
  return (META_LEAD_CTA_VALUES as readonly string[]).includes(value);
}

export function labelForMetaCta(cta: MetaCta | string | undefined): string {
  // Stored pre-remap packs may still say CONTACT_US; display them honestly.
  if (cta === "CONTACT_US") return LEGACY_CONTACT_US_LABEL;
  return cta && isMetaCta(cta) ? META_CTA_LABELS[cta] : META_CTA_LABELS.LEARN_MORE;
}

/**
 * Map a human CTA label to the Meta lead-ad button enum. The richest keyword
 * set wins: offer-shaped words (checklist/guide/report/...) mean DOWNLOAD,
 * appraisal/contact/book-shaped words mean GET_QUOTE.
 */
export function toMetaCta(label: string): MetaLeadCta {
  const upper = label.trim().toUpperCase().replace(/\s+/g, "_");
  if (isMetaCta(upper)) return upper;
  const normalised = label.trim().toLowerCase();
  if (/download|checklist|guide|report|timeline|snapshot/.test(normalised)) return "DOWNLOAD";
  if (/book|contact|request|appraisal|quote|enquir|call/.test(normalised)) return "GET_QUOTE";
  if (/apply/.test(normalised)) return "APPLY_NOW";
  if (/subscribe|newsletter/.test(normalised)) return "SUBSCRIBE";
  if (/sign/.test(normalised)) return "SIGN_UP";
  return "LEARN_MORE";
}

const remapWarnings = new Set<string>();

/**
 * Legacy packs may store CONTACT_US (undocumented for lead ads). Remap at
 * payload-build time — the stored value is never sent to Meta.
 */
export function remapLegacyMetaCta(value: string): MetaLeadCta {
  if (isMetaCta(value)) return value;
  if (value === "CONTACT_US") {
    if (!remapWarnings.has(value)) {
      remapWarnings.add(value);
      console.warn(
        "[meta-cta] legacy CTA CONTACT_US is not in Meta's documented lead-ads subset; remapping to LEARN_MORE at payload build.",
      );
    }
    return "LEARN_MORE";
  }
  return toMetaCta(value);
}
