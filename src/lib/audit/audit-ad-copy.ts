import type { AdTemplate, TextInput } from "../../../packages/ad-template-contract/src/types.ts";
import { META_COPY_CONSTRAINTS, truncateAtWordBoundary } from "../adstudio/meta-copy-contract.ts";
import { toMetaCta, type MetaCta } from "../adstudio/meta-cta.ts";

// ---------------------------------------------------------------------------
// Audit funnel ad copy.
//
// Pure: no database, no network, no clock-derived surprises beyond the caller
// supplying `context`. Everything here is deterministic for the same input, so
// the public preview and the copy saved into a workspace after signup are
// byte-identical.
//
// The teaching behind the angles comes from our own guides: one ad, one offer,
// one CTA; judge contactable homeowners rather than cost per lead; and fund
// learning rather than protecting a ratio. Copy stays specific to a suburb and
// stays honest — we never invent a phone number, a sold price, or a result.
// ---------------------------------------------------------------------------

export type AuditCopyContext = {
  businessName: string;
  suburb: string;
  postcode: string;
  websiteHost: string | null;
  /** Only ever a phone number scraped from the agency's own website. */
  phone: string | null;
};

export type AuditAngleCopy = {
  eyebrow: string;
  headline: string;
  body: string;
  cta: string;
  points: string[];
  /** Pre-trimmed Meta copy ready for an AdDocument. */
  meta: { primaryText: string; headline: string; description: string; cta: MetaCta };
};

type AngleTemplate = {
  eyebrow: string;
  headline: string;
  body: string;
  cta: string;
  points: string[];
};

const ANGLE_TEMPLATES: Record<string, AngleTemplate> = {
  "appraisal or valuation": {
    eyebrow: "LOCAL APPRAISAL",
    headline: "What's your home worth?",
    body: "A dated local appraisal from an agent who sells here, not an automated estimate.",
    cta: "Get the number",
    points: ["Priced by a local agent", "No lock-in, no spam", "Reply within one day"],
  },
  "just sold or results": {
    eyebrow: "RECENT RESULTS",
    headline: "What local homes sold for",
    body: "Recent local sales with the real numbers, not the asking prices.",
    cta: "See the results",
    points: ["Real sold prices", "Updated every week", "Street-level detail"],
  },
  "seller guide or market update": {
    eyebrow: "SELLER GUIDE",
    headline: "Thinking of selling?",
    body: "The things that move the price around here, in one short page.",
    cta: "Read the guide",
    points: ["What moves the price", "One short page", "No obligation"],
  },
  "open home": {
    eyebrow: "OPEN HOMES",
    headline: "Open this Saturday",
    body: "One list, updated Friday night, so nobody drives around guessing.",
    cta: "See the list",
    points: ["One updated list", "Every Saturday", "Address and times"],
  },
  "single listing": {
    eyebrow: "JUST LISTED",
    headline: "Just listed",
    body: "One property, the full story, before it reaches the portals.",
    cta: "See the property",
    points: ["Full photo set", "Before the portals", "Inspection times"],
  },
  "agent or agency brand": {
    eyebrow: "LOCAL AGENT",
    headline: "The agent who lives here",
    body: "Local, contactable, and not a call centre in another postcode.",
    cta: "Meet the agent",
    points: ["Lives in the area", "Contactable directly", "Not a call centre"],
  },
};

const GENERIC_POINTS = ["Local, not automated", "One clear next step", "No obligation"];

export type GapConceptLike = {
  key: string;
  label: string;
  headline: string;
  body: string;
  cta: string;
  rationale: string;
};

/**
 * Turn a market-gap concept from the suburb report into finished ad copy.
 * Unknown concept keys still produce usable copy from the concept's own text
 * rather than failing the funnel.
 */
export function resolveAngleCopy(concept: GapConceptLike, context: AuditCopyContext): AuditAngleCopy {
  const angle = ANGLE_TEMPLATES[concept.key];
  const place = context.suburb || context.postcode;

  if (!angle) {
    const headline = truncateAtWordBoundary(concept.headline || concept.label, 28);
    const points = GENERIC_POINTS.slice();
    return finishCopy({ eyebrow: concept.label.toUpperCase(), headline, body: concept.body, cta: concept.cta, points }, context, place);
  }

  return finishCopy(
    {
      eyebrow: angle.eyebrow,
      headline: substitute(angle.headline, place),
      body: substitute(angle.body, place),
      cta: angle.cta,
      points: angle.points.slice(),
    },
    context,
    place,
  );
}

function finishCopy(copy: Omit<AuditAngleCopy, "meta">, context: AuditCopyContext, place: string): AuditAngleCopy {
  const metaCta = toMetaCta(copy.cta);
  return {
    ...copy,
    meta: {
      primaryText: truncateAtWordBoundary(copy.body, META_COPY_CONSTRAINTS.primaryText),
      headline: truncateAtWordBoundary(copy.headline, META_COPY_CONSTRAINTS.headline),
      description: truncateAtWordBoundary(`${place} · ${copy.eyebrow.toLowerCase()}`, META_COPY_CONSTRAINTS.description),
      cta: metaCta,
    },
  };
}

function substitute(value: string, place: string): string {
  return value.replaceAll("{suburb}", place);
}

// ---------------------------------------------------------------------------
// Template text-input mapping.
// ---------------------------------------------------------------------------

type TextRole =
  | "eyebrow"
  | "headline"
  | "body"
  | "point"
  | "date"
  | "address"
  | "phone"
  | "website"
  | "handle"
  | "cta"
  | "other";

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function classifyTextInput(input: TextInput): TextRole {
  const key = normalise(input.key);
  const label = normalise(input.label);
  const haystack = `${key} ${label}`;

  if (/(^| )(eyebrow|script|kicker|badge|overtitle|tagline)($| )/.test(haystack)) return "eyebrow";
  if (/(^| )(headline|title|heading|hero title|display)($| )/.test(haystack)) return "headline";
  if (/^(point|feature|check|bullet|benefit|item)\b/.test(input.key.toLowerCase())) return "point";
  if (/(^| )(point|feature|check|bullet|benefit|item)\s+\d/.test(haystack)) return "point";
  if (/(date|when|saturday|sunday|time|inspection)($| )/.test(haystack)) return "date";
  if (/(address|location|suburb|property address)($| )/.test(haystack)) return "address";
  if (/(phone|tel|mobile|call)($| )/.test(haystack)) return "phone";
  if (/(website|url|domain|site|web)($| )/.test(haystack)) return "website";
  if (/(handle|social|instagram|facebook|tag)($| )/.test(haystack)) return "handle";
  if (/(^| )(cta|button|action)($| )/.test(haystack)) return "cta";
  if (/(body|intro|copy|description|paragraph|text|sub)($| )/.test(haystack)) return "body";
  return "other";
}

function pointIndex(input: TextInput): number {
  const digits = /(\d+)/.exec(normalise(`${input.key} ${input.label}`));
  return digits ? Math.max(0, Number(digits[1]) - 1) : 0;
}

/** Uppercase the next Saturday date, e.g. "SATURDAY 20 SEPTEMBER". */
export function nextSaturdayLabel(now = new Date()): string {
  const date = new Date(now.getTime());
  const offset = (6 - date.getUTCDay() + 7) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + offset);
  const day = date.getUTCDate();
  const month = date.toLocaleString("en-AU", { month: "long", timeZone: "UTC" }).toUpperCase();
  return `SATURDAY ${day} ${month}`;
}

function slugHandle(businessName: string): string {
  const slug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20);
  return slug ? `@${slug}` : "";
}

/**
 * Smallest character budget actually available to an input: the declared
 * input max, tightened by every text layer bound to it. Templates refuse text
 * that exceeds a layer's maxCharacters, so honouring the minimum keeps the
 * render deterministic instead of relying on the refusal path.
 */
export function maxCharsForInput(template: AdTemplate, inputKey: string, declared: number): number {
  let max = Number.isFinite(declared) && declared > 0 ? declared : 120;
  for (const layout of [template.feedLayout, template.storyLayout]) {
    for (const layer of layout.layers) {
      if (layer.type === "text" && layer.inputKey === inputKey && layer.maxCharacters > 0) {
        max = Math.min(max, layer.maxCharacters);
      }
    }
  }
  return max;
}

/** Trim to a word boundary so generated copy never ends mid-word. */
export function fitCopy(value: string, max: number): string {
  const text = value.trim();
  if (max <= 0) return "";
  if (text.length <= max) return text;
  return truncateAtWordBoundary(text, max);
}

/**
 * Build the render values for every text input in a template. Inputs we have
 * no honest value for (a phone number we did not find on their site, for
 * example) keep the template placeholder rather than invented data.
 */
export function buildAuditTextValues(
  template: AdTemplate,
  copy: AuditAngleCopy,
  context: AuditCopyContext,
  options: { dateAngle?: boolean } = {},
): Record<string, string> {
  const values: Record<string, string> = {};
  const place = context.suburb || context.postcode;
  const seenPoints = new Map<number, number>();
  const useDate = options.dateAngle === true;

  for (const input of template.textInputs) {
    const role = classifyTextInput(input);
    let raw = valueForRole(role, input, copy, context, place, seenPoints);
    if (role === "date" && !useDate) raw = null;
    const value = raw === null ? input.placeholder : raw;
    values[input.key] = fitCopy(value, maxCharsForInput(template, input.key, input.maxLength));
  }

  return values;
}

function valueForRole(
  role: TextRole,
  input: TextInput,
  copy: AuditAngleCopy,
  context: AuditCopyContext,
  place: string,
  seenPoints: Map<number, number>,
): string | null {
  switch (role) {
    case "eyebrow":
      return copy.eyebrow;
    case "headline":
      return copy.headline;
    case "body":
      return copy.body;
    case "point": {
      const base = pointIndex(input);
      const nth = seenPoints.get(base) ?? 0;
      seenPoints.set(base, nth + 1);
      const points = copy.points.length > 0 ? copy.points : GENERIC_POINTS;
      return points[(base + nth) % points.length] ?? points[0] ?? null;
    }
    case "date":
      return nextSaturdayLabel();
    case "address":
      return place;
    case "phone":
      return context.phone;
    case "website":
      return context.websiteHost ? context.websiteHost : null;
    case "handle":
      return slugHandle(context.businessName) || null;
    case "cta":
      return copy.cta;
    case "other":
      return null;
  }
}

/**
 * Placeholder values for the same template. Used when personalised copy fails
 * the renderer's text preflight: a reviewed template is guaranteed to render
 * with its own placeholders, so the funnel degrades instead of erroring.
 */
export function placeholderTextValues(template: AdTemplate): Record<string, string> {
  return Object.fromEntries(template.textInputs.map((input) => [input.key, input.placeholder]));
}
