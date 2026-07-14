import type { AdStudioTemplate } from "../../lib/adstudio/index.ts";
import type { AdStudioBrandKit } from "../../lib/adstudio/types.ts";

export type TemplateImageRequirementRole = "primary" | "secondary" | "agent_headshot";

export type TemplateImageRequirement = {
  id: string;
  label: string;
  guidance?: string;
  role: TemplateImageRequirementRole;
  required: boolean;
};

export const DEFAULT_IMAGE_SLOT: TemplateImageRequirement = {
  id: "property_photo",
  label: "Property image",
  role: "primary",
  required: true,
};

export type TemplateCopyRequirement = {
  key: string;
  label: string;
  maxLength: number;
  required: boolean;
  /** Safe sample text shown as a placeholder, never submitted as customer copy. */
  sample: string;
};

/** Use the approved Brand Studio logo for declared logo inputs by default. */
export function defaultImageForTemplateSlot(
  slot: Pick<TemplateImageRequirement, "id" | "label">,
  brandKit: Pick<AdStudioBrandKit, "logos"> | undefined,
): string {
  if (!/logo/i.test(`${slot.id} ${slot.label}`)) return "";
  return (
    brandKit?.logos.primaryLogoUrl?.trim() ||
    brandKit?.logos.darkLogoUrl?.trim() ||
    brandKit?.logos.lightLogoUrl?.trim() ||
    brandKit?.logos.faviconUrl?.trim() ||
    ""
  );
}

export function customerCopyFieldsForTemplate(
  template: AdStudioTemplate | undefined,
): TemplateCopyRequirement[] {
  return (template?.inputs.text ?? []).map((field) => ({
    key: field.key,
    label: field.label,
    maxLength: field.maxLength,
    required: field.required,
    sample: field.sample,
  }));
}

export function imageRequirementsForTemplate(
  template: AdStudioTemplate | undefined,
): TemplateImageRequirement[] {
  return (template?.inputs.images ?? []).map((input, index) => ({
    id: input.key,
    label: input.label,
    guidance: input.aspect ? `${capitalize(input.aspect)} image` : undefined,
    role: roleForInput(input.key, index),
    required: input.required,
  }));
}

function roleForInput(key: string, index: number): TemplateImageRequirementRole {
  if (/agent|avatar|headshot|portrait|profile/u.test(key)) return "agent_headshot";
  return index === 0 || /hero|main|primary|property/u.test(key) ? "primary" : "secondary";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
