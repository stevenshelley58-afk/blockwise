import {
  builtInAdStudioTemplates,
  isBuiltInAdStudioTemplate,
  type AdStudioTemplate,
} from "./templates.ts";

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
  if (!isBuiltInAdStudioTemplate(key)) throw new Error("Selected template was not found or is not approved.");
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
