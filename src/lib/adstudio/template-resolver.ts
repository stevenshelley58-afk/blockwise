import { createSupabaseServiceClient } from "../supabase/service.ts";

import {
  builtInAdStudioTemplates,
  mapAdStudioLibraryTemplate,
  type AdStudioLibraryTemplate,
  type AdStudioTemplate,
} from "./templates.ts";

const TEMPLATE_LIBRARY_SELECT =
  "template_key,status,category,hook_style,funnel_stage,adstudio_template_id,offer_id,goal,headline,primary_text,description,cta,image_brief_id,sample_card_image_path,sample_style,ai_prompt_seed,creative_skeleton,template_designs,template_version,brief_schema,exemplar_observed_ad_ids,evidence_score,winner_rationale,compliance_note";

export function isMissingTemplateLibrary(error: { code?: string; message?: string } | null | undefined): boolean {
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    /(?:v_ad_template_library|ad_template_candidates|relation .* does not exist|column .* does not exist)/i.test(error?.message ?? "")
  );
}

export async function resolveApprovedAdStudioTemplate(input: {
  templateKey?: string | null;
  templateId?: string | null;
}): Promise<AdStudioTemplate> {
  const key = cleanTemplateKey(input.templateKey) ?? cleanTemplateKey(input.templateId);
  if (!key) throw new Error("Selected template was not found.");

  let research;
  try {
    research = createSupabaseServiceClient().schema("research");
  } catch {
    return resolveBuiltInApprovedTemplate(key);
  }

  const { data, error } = await research
    .from("v_ad_template_library")
    .select(TEMPLATE_LIBRARY_SELECT)
    .eq("template_key", key)
    .maybeSingle();

  if (isMissingTemplateLibrary(error)) return resolveBuiltInApprovedTemplate(key);
  if (error) throw new Error(error.message);

  if (data) {
    const template = mapAdStudioLibraryTemplate(data as AdStudioLibraryTemplate);
    if (template) return template;
  }

  return resolveBuiltInApprovedTemplate(key);
}

export function templatePromptHint(template: AdStudioTemplate | null | undefined): string | undefined {
  if (!template) return undefined;
  const skeleton = template.creativeSkeleton;
  return [
    template.promptHint,
    skeleton ? `Template skeleton: ${skeleton.archetype}.` : "",
    skeleton ? `Copy pattern: ${skeleton.copy.headline_pattern}; CTA: ${skeleton.copy.cta}.` : "",
    skeleton ? `Composition: ${skeleton.composition.focal_point}; reserve ${skeleton.composition.copy_safe_zones.map((zone) => `${zone.id} ${zone.priority ?? "copy"}`).join(", ")}.` : "",
    template.manualFirstPass ? "Internal metadata: first-pass/manual skeleton; use customer media and brief, not invented proof." : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function resolveBuiltInApprovedTemplate(key: string): AdStudioTemplate {
  const template = builtInAdStudioTemplates().find((candidate) => candidate.templateKey === key || candidate.id === key);
  if (!template || template.status !== "approved") {
    throw new Error("Selected template was not found or is not approved.");
  }
  return template;
}

function cleanTemplateKey(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
