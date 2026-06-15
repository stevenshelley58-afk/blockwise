import type { AdStudioGoal } from "./types.ts";
import { creativeSkeletonSchema, type CreativeSkeleton } from "../ad-template-library/skeleton.ts";

export type AdStudioTemplate = {
  id: string;
  templateKey?: string;
  name: string;
  goal: AdStudioGoal;
  offerId: string;
  promptHint: string;
  source?: "builtin" | "operator" | "radar";
  status?: "approved" | "archived" | "draft";
  creativeSkeleton?: CreativeSkeleton;
  exemplars?: string[];
  evidenceScore?: number;
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
  creative_skeleton?: unknown;
  exemplar_observed_ad_ids?: string[] | null;
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

  const headline = stringValue(row.headline);
  const primaryText = stringValue(row.primary_text);
  const description = stringValue(row.description);
  const aiPromptSeed = stringValue(row.ai_prompt_seed);
  const promptHint = [headline, primaryText, description, aiPromptSeed, row.cta ? `CTA: ${row.cta}` : ""]
    .filter(Boolean)
    .join(" ");

  if (!promptHint) return null;

  const creativeSkeleton = parseCreativeSkeleton(row.creative_skeleton);
  const exemplars = Array.isArray(row.exemplar_observed_ad_ids)
    ? row.exemplar_observed_ad_ids.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  return {
    id: templateKey,
    templateKey,
    name: humanizeTemplateName(templateKey, row.category, row.hook_style),
    goal: goal as AdStudioGoal,
    offerId,
    promptHint,
    source: "radar",
    status: "approved",
    evidenceScore: numberValue(row.evidence_score),
    ...(creativeSkeleton ? { creativeSkeleton } : {}),
    ...(exemplars.length > 0 ? { exemplars } : {}),
  };
}

export function mergeAdStudioTemplateLibrary(approved: AdStudioTemplate[]): AdStudioTemplate[] {
  if (approved.length === 0) return builtInAdStudioTemplates();
  const byId = new Map<string, AdStudioTemplate>();
  for (const template of approved) byId.set(template.id, template);
  for (const template of builtInAdStudioTemplates()) {
    if (!byId.has(template.id)) byId.set(template.id, template);
  }
  return [...byId.values()].sort(compareTemplateVisibility);
}

export const ADSTUDIO_TEMPLATE_VERSIONS: AdStudioTemplateVersion[] = AD_STUDIO_TEMPLATES.map((template) => ({
  templateId: template.id,
  vertical: "real_estate",
  goal: template.goal,
  offerType: template.offerId,
  active: true,
}));

function humanizeTemplateName(templateKey: string, category?: string | null, hookStyle?: string | null): string {
  const label = [category, hookStyle].map(stringValue).filter(Boolean).join(" ");
  return label ? toTitleCase(label) : toTitleCase(templateKey.replace(/[-_]+/gu, " "));
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

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseCreativeSkeleton(value: unknown): CreativeSkeleton | undefined {
  const parsed = creativeSkeletonSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function compareTemplateVisibility(a: AdStudioTemplate, b: AdStudioTemplate): number {
  const priority = (template: AdStudioTemplate) => {
    if (template.creativeSkeleton) return 0;
    if (template.source === "radar") return 1;
    return 2;
  };

  const priorityDiff = priority(a) - priority(b);
  if (priorityDiff !== 0) return priorityDiff;

  const evidenceDiff = (b.evidenceScore ?? -1) - (a.evidenceScore ?? -1);
  if (evidenceDiff !== 0) return evidenceDiff;

  return a.name.localeCompare(b.name);
}
