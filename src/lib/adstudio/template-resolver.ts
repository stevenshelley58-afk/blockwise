import {
  ADSTUDIO_TEMPLATE_RESET_MESSAGE,
  builtInAdStudioTemplates,
  isBuiltInAdStudioTemplate,
  type AdStudioTemplate,
} from "./templates.ts";

export async function resolveApprovedAdStudioTemplate(input: {
  templateKey?: string | null;
  templateId?: string | null;
}): Promise<AdStudioTemplate> {
  const key = cleanTemplateKey(input.templateKey) ?? cleanTemplateKey(input.templateId);
  if (!key) throw new Error("Selected template was not found.");
  if (!isBuiltInAdStudioTemplate(key)) throw new Error(ADSTUDIO_TEMPLATE_RESET_MESSAGE);
  return resolveBuiltInApprovedTemplate(key);
}

export function templatePromptHint(template: AdStudioTemplate | null | undefined): string | undefined {
  if (!template) return undefined;
  return template.promptHint;
}

function resolveBuiltInApprovedTemplate(key: string): AdStudioTemplate {
  const template = builtInAdStudioTemplates().find((candidate) => candidate.templateKey === key || candidate.id === key);
  if (!template || template.status !== "approved") {
    throw new Error(ADSTUDIO_TEMPLATE_RESET_MESSAGE);
  }
  return template;
}

function cleanTemplateKey(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
