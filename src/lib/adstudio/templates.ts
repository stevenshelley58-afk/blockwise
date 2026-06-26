import { templateDesignSchema, type TemplateDesignSet } from "./template-design.ts";
import type { AdStudioGoal } from "./types.ts";
import { templateDesignSetFromCreativeSkeleton } from "../ad-template-library/template-design-from-skeleton.ts";
import { creativeSkeletonSchema, type CreativeSkeleton } from "../ad-template-library/skeleton.ts";
import { EXTRACTED_META_AD_STUDIO_TEMPLATES } from "./extracted-meta-template-builder.ts";
import { GOLD_AD_STUDIO_TEMPLATES } from "./gold-adstudio-templates.ts";
import { STANDALONE_AD_STUDIO_TEMPLATES } from "./standalone-templates/index.ts";
import {
  deriveTemplateSampleStyle,
  sampleCopyForTemplate,
  templateCardPublicUrl,
  type AdStudioTemplateSampleCopy,
  type AdStudioTemplateSampleStyle,
} from "./template-samples.ts";

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
  imageBriefId?: string;
  sampleCopy?: AdStudioTemplateSampleCopy;
  sampleStyle?: AdStudioTemplateSampleStyle;
  sampleCardImageUrl?: string;
  designs?: TemplateDesignSet;
  evidenceScore?: number;
  winnerRationale?: string;
  complianceNote?: string;
  manualFirstPass?: boolean;
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
  sample_card_image_path?: string | null;
  sample_style?: unknown;
  ai_prompt_seed?: string | null;
  creative_skeleton?: unknown;
  template_design?: unknown;
  template_designs?: unknown;
  template_version?: number | string | null;
  brief_schema?: unknown;
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
  ...GOLD_AD_STUDIO_TEMPLATES,
  ...STANDALONE_AD_STUDIO_TEMPLATES,
];

export const RESOLVABLE_AD_STUDIO_TEMPLATES: AdStudioTemplate[] = uniqueTemplates([
  ...AD_STUDIO_TEMPLATES,
  ...EXTRACTED_META_AD_STUDIO_TEMPLATES,
]);

export function resolveAdStudioTemplate(templateId: string | undefined): AdStudioTemplate {
  return RESOLVABLE_AD_STUDIO_TEMPLATES.find((template) => template.id === templateId) ?? AD_STUDIO_TEMPLATES[0];
}

export function isBuiltInAdStudioTemplate(templateId: string | undefined): boolean {
  return RESOLVABLE_AD_STUDIO_TEMPLATES.some((template) => template.id === templateId);
}

export function builtInAdStudioTemplates(): AdStudioTemplate[] {
  return GOLD_AD_STUDIO_TEMPLATES.map(withTemplateDefaults);
}

export function resolvableAdStudioTemplates(): AdStudioTemplate[] {
  return RESOLVABLE_AD_STUDIO_TEMPLATES.map(withTemplateDefaults);
}

function withTemplateDefaults(template: AdStudioTemplate): AdStudioTemplate {
  return {
    ...template,
    templateKey: template.templateKey ?? template.id,
    source: template.source ?? "builtin",
    status: template.status ?? "approved",
  };
}

function uniqueTemplates(templates: AdStudioTemplate[]): AdStudioTemplate[] {
  const seen = new Set<string>();
  return templates.filter((template) => {
    const key = template.id || template.templateKey;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mapAdStudioLibraryTemplate(row: AdStudioLibraryTemplate): AdStudioTemplate | null {
  if (row.status && row.status !== "approved") return null;

  const templateKey = stringValue(row.template_key);
  if (!templateKey) return null;

  const builtInTemplateKey = stringValue(row.adstudio_template_id);
  const builtIn = AD_STUDIO_TEMPLATES.find((template) =>
    template.id === builtInTemplateKey ||
    template.templateKey === builtInTemplateKey ||
    template.id === templateKey ||
    template.templateKey === templateKey
  );
  const goal = stringValue(row.goal) || builtIn?.goal;
  const offerId = stringValue(row.offer_id) || builtIn?.offerId;
  if (!goal || !offerId) return null;

  const promptHint = safeLibraryPromptHint({
    builtIn,
    goal,
    offerId,
  });

  const creativeSkeleton = parseCreativeSkeleton(row.creative_skeleton);
  const templateVersion = numberValue(row.template_version) ?? 1;
  const designs =
    parseTemplateDesigns(row.template_designs ?? row.template_design) ??
    (creativeSkeleton
      ? templateDesignSetFromCreativeSkeleton({
          templateId: templateKey,
          version: templateVersion,
          skeleton: creativeSkeleton,
        })
      : undefined);
  const sampleStyle = parseSampleStyle(row.sample_style) ?? deriveTemplateSampleStyle({ ...row, template_key: templateKey });
  const sampleCopy = sampleCopyForTemplate({ ...row, template_key: templateKey }, sampleStyle);
  const sampleCardImageUrl =
    templateCardPublicUrl(row.sample_card_image_path) ??
    (row.sample_card_image_path ? undefined : templateCardPublicUrl(sampleStyle.sampleCardImagePath));
  const exemplars = Array.isArray(row.exemplar_observed_ad_ids)
    ? row.exemplar_observed_ad_ids.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const manualFirstPass = /first-pass|manual|first pass/i.test(row.winner_rationale ?? "");

  return {
    id: templateKey,
    templateKey,
    name: safeLibraryTemplateName({ builtIn, goal, offerId }),
    goal: goal as AdStudioGoal,
    offerId,
    promptHint,
    source: manualFirstPass ? "operator" : "radar",
    status: "approved",
    ...(row.image_brief_id ? { imageBriefId: row.image_brief_id } : {}),
    ...(sampleCopy ? { sampleCopy } : {}),
    sampleStyle,
    ...(sampleCardImageUrl ? { sampleCardImageUrl } : {}),
    ...(numberValue(row.evidence_score) !== undefined ? { evidenceScore: numberValue(row.evidence_score) } : {}),
    ...(row.winner_rationale ? { winnerRationale: row.winner_rationale } : {}),
    ...(row.compliance_note ? { complianceNote: row.compliance_note } : {}),
    ...(manualFirstPass ? { manualFirstPass: true } : {}),
    ...(creativeSkeleton ? { creativeSkeleton } : {}),
    ...(designs ? { designs } : {}),
    ...(exemplars.length > 0 ? { exemplars } : {}),
  };
}

export function mergeAdStudioTemplateLibrary(_approved: AdStudioTemplate[]): AdStudioTemplate[] {
  return builtInAdStudioTemplates();
}

export const ADSTUDIO_TEMPLATE_VERSIONS: AdStudioTemplateVersion[] = AD_STUDIO_TEMPLATES.map((template) => ({
  templateId: template.id,
  vertical: "real_estate",
  goal: template.goal,
  offerType: template.offerId,
  active: true,
}));

function safeLibraryPromptHint(input: {
  builtIn?: AdStudioTemplate;
  goal: string;
  offerId: string;
}): string {
  if (input.builtIn?.promptHint) return input.builtIn.promptHint;

  const label = safeLibraryTemplateName(input);
  const goal = toTitleCase(input.goal.replace(/[-_]+/gu, " "));
  const offer = toTitleCase(input.offerId.replace(/[-_]+/gu, " "));
  return `${label} template for ${goal}: use customer media, local market context, compliant copy, and a direct call to action for ${offer}.`;
}

function safeLibraryTemplateName(input: { builtIn?: AdStudioTemplate; goal: string; offerId: string }): string {
  if (input.builtIn?.name) return input.builtIn.name;
  switch (input.offerId) {
    case "listing_inquiries":
      return "Listing campaign";
    case "home_value_update":
      return "Free appraisal";
    case "buyer_list":
      return "Buyer inquiry";
    case "market_report":
      return "Market update";
    case "download_guide":
      return "Seller guide";
    default:
      break;
  }
  switch (input.goal) {
    case "market_update_leads":
      return "Market update";
    case "appraisal_bookings":
      return "Free appraisal";
    case "open_home_followup":
      return "Open home follow-up";
    case "listing_nurture":
      return "Sold nurture";
    case "downsizer_leads":
      return "Downsizer inquiry";
    case "investor_leads":
      return "Investor inquiry";
    default:
      return "Ad template";
  }
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
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseCreativeSkeleton(value: unknown): CreativeSkeleton | undefined {
  const parsed = creativeSkeletonSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function parseTemplateDesigns(value: unknown): TemplateDesignSet | undefined {
  if (!isRecord(value)) return undefined;

  const single = templateDesignSchema.safeParse(value);
  if (single.success) return { [single.data.format]: single.data };

  const designs: TemplateDesignSet = {};
  for (const format of ["9:16", "4:5", "1:1", "1.91:1"] as const) {
    const parsed = templateDesignSchema.safeParse(value[format]);
    if (parsed.success) designs[format] = parsed.data;
  }

  return Object.keys(designs).length > 0 ? designs : undefined;
}

function parseSampleStyle(value: unknown): AdStudioTemplateSampleStyle | undefined {
  if (!isRecord(value)) return undefined;
  if (value.version !== "template-samples-v1") return undefined;
  if (typeof value.sampleCardImagePath !== "string") return undefined;
  return value as AdStudioTemplateSampleStyle;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
