// The ONE source of truth for Meta lead-ad CTA buttons.
//
// Three divergent label→enum keyword maps used to live in use-copy.ts,
// readiness.ts, and generator.ts — a CTA could map to different buttons
// depending on which code path touched it. This module replaces all three.

export const META_CTA_VALUES = ["LEARN_MORE", "SIGN_UP", "DOWNLOAD", "CONTACT_US"] as const;

export type MetaCta = (typeof META_CTA_VALUES)[number];

export const META_CTA_LABELS: Record<MetaCta, string> = {
  LEARN_MORE: "Learn more",
  SIGN_UP: "Sign up",
  DOWNLOAD: "Download",
  CONTACT_US: "Contact us",
};

export function isMetaCta(value: string): value is MetaCta {
  return (META_CTA_VALUES as readonly string[]).includes(value);
}

export function labelForMetaCta(cta: MetaCta | string | undefined): string {
  return cta && isMetaCta(cta) ? META_CTA_LABELS[cta] : META_CTA_LABELS.LEARN_MORE;
}

/**
 * Map a human CTA label to the Meta button enum. The richest keyword set wins:
 * offer-shaped words (checklist/guide/report/...) mean DOWNLOAD, action words
 * (book/contact/request/appraisal/update) mean CONTACT_US.
 */
export function toMetaCta(label: string): MetaCta {
  const upper = label.trim().toUpperCase().replace(/\s+/g, "_");
  if (isMetaCta(upper)) return upper;
  const normalised = label.trim().toLowerCase();
  if (/download|checklist|guide|report|timeline|snapshot/.test(normalised)) return "DOWNLOAD";
  if (/book|contact|request|appraisal|update|enquir|call/.test(normalised)) return "CONTACT_US";
  if (/sign/.test(normalised)) return "SIGN_UP";
  return "LEARN_MORE";
}
