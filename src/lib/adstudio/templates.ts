import type { AdStudioGoal } from "./types.ts";

export type AdStudioTemplate = {
  id: string;
  templateKey?: string;
  name: string;
  goal: AdStudioGoal;
  offerId: string;
  promptHint: string;
  source?: "builtin" | "operator" | "radar";
  status?: "approved" | "archived" | "draft";
  /** Clean sample copy for the gallery preview only — never the raw prompt seed. */
  preview?: { eyebrow: string; headline: string; cta: string };
};

export type AdStudioLibraryTemplate = {
  template_key?: string | null;
  status?: string | null;
  category?: string | null;
  hook_style?: string | null;
  funnel_stage?: string | null;
  adstudio_template_id?: string | null;
  offer_id?: string | null;
  goal?: string | null;
  headline?: string | null;
  primary_text?: string | null;
  description?: string | null;
  cta?: string | null;
  image_brief_id?: string | null;
  ai_prompt_seed?: string | null;
  evidence_score?: number | string | null;
  winner_rationale?: string | null;
  compliance_note?: string | null;
};

export type AdStudioTemplateVersion = {
  templateId: string;
  vertical: "real_estate";
  goal: AdStudioGoal;
  offerType: string;
  active: boolean;
};

export const AD_STUDIO_TEMPLATES: AdStudioTemplate[] = [
  {
    id: "just_listed",
    name: "Just listed",
    goal: "seller_leads",
    offerId: "home_value_update",
    promptHint: "Promote a newly listed property and invite local owners to compare their own home.",
  },
  {
    id: "coming_soon",
    name: "Coming soon",
    goal: "seller_leads",
    offerId: "home_value_update",
    promptHint: "Tease an upcoming listing and create local interest before launch.",
  },
  {
    id: "new_to_market",
    name: "New to market",
    goal: "seller_leads",
    offerId: "recent_sales_report",
    promptHint: "Announce fresh local activity and prompt owners to check recent sales context.",
  },
  {
    id: "open_home",
    name: "Open home",
    goal: "open_home_followup",
    offerId: "open_home_followup",
    promptHint: "Promote inspection interest with date, time, property details, and a simple enquiry path.",
  },
  {
    id: "just_sold",
    name: "Just sold",
    goal: "seller_leads",
    offerId: "recent_sales_report",
    promptHint: "Use a recent sale as local proof and invite nearby owners to understand their position.",
  },
  {
    id: "price_update",
    name: "Price update",
    goal: "appraisal_bookings",
    offerId: "home_value_update",
    promptHint: "Offer a practical home value update without making performance guarantees.",
  },
  {
    id: "market_update",
    name: "Market update",
    goal: "market_update_leads",
    offerId: "suburb_market_report",
    promptHint: "Share useful suburb market context for homeowners considering their next move.",
  },
  {
    id: "free_appraisal",
    name: "Free appraisal",
    goal: "appraisal_bookings",
    offerId: "home_value_update",
    promptHint: "Invite owners to request a no-pressure local price update.",
  },
  {
    id: "buyer_demand",
    name: "Buyer demand",
    goal: "seller_leads",
    offerId: "home_value_update",
    promptHint: "Explain local buyer demand carefully without over-claiming results.",
  },
  {
    id: "seller_checklist",
    name: "Seller checklist",
    goal: "seller_leads",
    offerId: "seller_prep_checklist",
    promptHint: "Offer a practical preparation checklist for owners thinking about selling.",
  },
];

export function resolveAdStudioTemplate(templateId: string | undefined): AdStudioTemplate {
  return AD_STUDIO_TEMPLATES.find((template) => template.id === templateId) ?? AD_STUDIO_TEMPLATES[0];
}

export function isBuiltInAdStudioTemplate(templateId: string | undefined): boolean {
  return AD_STUDIO_TEMPLATES.some((template) => template.id === templateId);
}

export function builtInAdStudioTemplates(): AdStudioTemplate[] {
  return AD_STUDIO_TEMPLATES.map((template) => ({
    ...template,
    templateKey: template.templateKey ?? template.id,
    source: "builtin",
    status: "approved",
  }));
}

export function mapAdStudioLibraryTemplate(row: AdStudioLibraryTemplate): AdStudioTemplate | null {
  if (row.status && row.status !== "approved") return null;

  const templateKey = stringValue(row.template_key);
  if (!templateKey) return null;

  const builtIn = AD_STUDIO_TEMPLATES.find((template) => template.id === stringValue(row.adstudio_template_id));
  const goal = stringValue(row.goal) || builtIn?.goal;
  const offerId = stringValue(row.offer_id) || builtIn?.offerId;
  if (!goal || !offerId) return null;

  // Real, customer-facing sample copy. The raw ai_prompt_seed (layout/palette
  // directives, {{tokens}}, [FREE] flashes) is for server-side generation only
  // and must never reach the UI — so it is deliberately left out of the template.
  const headline = sanitizeSampleCopy(stringValue(row.headline));
  const description = sanitizeSampleCopy(stringValue(row.description));
  const cta = sanitizeSampleCopy(stringValue(row.cta));
  const name = builtIn?.name ?? humanizeTemplateName(templateKey, row.category, row.hook_style);
  // A short, human one-liner for hints/placeholders — not the prompt seed.
  const hint = builtIn?.promptHint || description || headline || name;

  if (!headline && !description && !builtIn) return null;

  return {
    id: templateKey,
    templateKey,
    name,
    goal: goal as AdStudioGoal,
    offerId,
    promptHint: hint.slice(0, 160),
    source: "radar",
    status: "approved",
    preview: headline ? { eyebrow: name, headline, cta: cta || "Learn more" } : undefined,
  };
}

/**
 * Strip prompt scaffolding from mined copy so only clean, real ad text reaches
 * the UI: replace {{suburb}} with a readable word, drop any other {{tokens}},
 * and collapse whitespace. The full seed stays server-side for generation.
 */
export function sanitizeSampleCopy(text: string): string {
  return stringValue(text)
    .replace(/\{\{\s*suburb\s*\}\}/giu, "your suburb")
    .replace(/\{\{[^}]*\}\}/gu, "")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

export function mergeAdStudioTemplateLibrary(approved: AdStudioTemplate[]): AdStudioTemplate[] {
  if (approved.length === 0) return builtInAdStudioTemplates();
  const byId = new Map<string, AdStudioTemplate>();
  for (const template of approved) byId.set(template.id, template);
  for (const template of builtInAdStudioTemplates()) {
    if (!byId.has(template.id)) byId.set(template.id, template);
  }
  return [...byId.values()];
}

export const ADSTUDIO_TEMPLATE_VERSIONS: AdStudioTemplateVersion[] = AD_STUDIO_TEMPLATES.map((template) => ({
  templateId: template.id,
  vertical: "real_estate",
  goal: template.goal,
  offerType: template.offerId,
  active: true,
}));

function humanizeTemplateName(templateKey: string, category?: string | null, hookStyle?: string | null): string {
  // Categories can arrive as a slashed taxonomy ("Market Update / Report Data /
  // Stat-led"); keep only the leading, recognisable label for the card title.
  const lead = stringValue(category).split("/")[0]?.trim() || stringValue(hookStyle);
  return lead ? toTitleCase(lead) : toTitleCase(templateKey.replace(/[-_]+/gu, " "));
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
