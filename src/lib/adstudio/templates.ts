import type { AdStudioGoal } from "./types.ts";

export const ADSTUDIO_TEMPLATE_RESET_MESSAGE =
  "AdStudio templates have been hard-reset. No templates are installed until fresh self-contained templates are built.";

export type AdStudioTemplateSampleCopy = {
  headline: string;
  primaryText: string;
  description?: string;
  cta: string;
};

export type AdStudioTemplate = {
  id: string;
  templateKey?: string;
  name: string;
  goal: AdStudioGoal;
  offerId: string;
  promptHint: string;
  source?: "builtin" | "operator" | "radar";
  status?: "approved" | "archived" | "draft";
  sampleCopy?: AdStudioTemplateSampleCopy;
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
  ai_prompt_seed?: string | null;
  brief_schema?: unknown;
};

export type AdStudioTemplateVersion = {
  templateId: string;
  vertical: "real_estate";
  goal: AdStudioGoal;
  offerType: string;
  active: boolean;
};

export const AD_STUDIO_TEMPLATES: AdStudioTemplate[] = [];
export const RESOLVABLE_AD_STUDIO_TEMPLATES: AdStudioTemplate[] = [];
export const ADSTUDIO_TEMPLATE_VERSIONS: AdStudioTemplateVersion[] = [];

export function resolveAdStudioTemplate(templateId: string | undefined): AdStudioTemplate | null {
  if (!templateId) return null;
  return RESOLVABLE_AD_STUDIO_TEMPLATES.find((template) => template.id === templateId || template.templateKey === templateId) ?? null;
}

export function isBuiltInAdStudioTemplate(_templateId: string | undefined): boolean {
  return false;
}

export function builtInAdStudioTemplates(): AdStudioTemplate[] {
  return [];
}

export function resolvableAdStudioTemplates(): AdStudioTemplate[] {
  return [];
}

export function mapAdStudioLibraryTemplate(_row: AdStudioLibraryTemplate): AdStudioTemplate | null {
  return null;
}

export function mergeAdStudioTemplateLibrary(_approved: AdStudioTemplate[]): AdStudioTemplate[] {
  return [];
}
