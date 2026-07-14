import {
  builtInAdStudioTemplates,
  isBuiltInAdStudioTemplate,
  type AdStudioTemplate,
} from "./templates.ts";

export async function resolveApprovedAdStudioTemplate(input: {
  templateId?: string | null;
}): Promise<AdStudioTemplate> {
  const key = cleanTemplateId(input.templateId);
  if (!key) throw new Error("Selected template was not found.");
  if (!isBuiltInAdStudioTemplate(key)) throw new Error("Selected template was not found.");
  return resolveBuiltInApprovedTemplate(key);
}

function resolveBuiltInApprovedTemplate(key: string): AdStudioTemplate {
  const template = builtInAdStudioTemplates().find((candidate) => candidate.id === key);
  if (!template || template.status !== "approved") {
    throw new Error("Selected sample was not found.");
  }
  return template;
}

function cleanTemplateId(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
