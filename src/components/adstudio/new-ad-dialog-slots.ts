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

type BrandKitDefaults = Pick<AdStudioBrandKit, "assets" | "contact" | "identity" | "logos" | "source">;
type BrandAssetDefaults = Pick<AdStudioBrandKit, "logos"> & Partial<Pick<AdStudioBrandKit, "assets">>;

/** Use reusable Brand Pack assets for matching identity slots. */
export function defaultImageForTemplateSlot(
  slot: Pick<TemplateImageRequirement, "id" | "label">,
  brandKit: BrandAssetDefaults | undefined,
): string {
  const identity = `${slot.id} ${slot.label}`;
  if (/logo/i.test(identity)) {
    return (
      brandKit?.logos.primaryLogoUrl?.trim() ||
      brandKit?.logos.darkLogoUrl?.trim() ||
      brandKit?.logos.lightLogoUrl?.trim() ||
      brandKit?.logos.faviconUrl?.trim() ||
      ""
    );
  }
  if (/agent|avatar|headshot|portrait|profile/i.test(identity)) {
    return brandKit?.assets?.headshots.find((src) => src.trim())?.trim() || "";
  }
  if (/office|team/i.test(identity)) {
    return brandKit?.assets?.officeImages.find((src) => src.trim())?.trim() || "";
  }
  return "";
}

export function defaultImageLabelForTemplateSlot(
  slot: Pick<TemplateImageRequirement, "id" | "label">,
  brandKit: BrandAssetDefaults | undefined,
): string {
  if (!defaultImageForTemplateSlot(slot, brandKit)) return "";
  const identity = `${slot.id} ${slot.label}`;
  if (/logo/i.test(identity)) return "Brand Pack logo";
  if (/agent|avatar|headshot|portrait|profile/i.test(identity)) return "Brand Pack headshot";
  if (/office|team/i.test(identity)) return "Brand Pack image";
  return "Brand Pack asset";
}

/** Prefill identity facts only. Campaign-specific claims must stay explicit. */
export function defaultTextForTemplateField(
  field: Pick<TemplateCopyRequirement, "key" | "label">,
  brandKit: BrandKitDefaults | undefined,
): string {
  if (!brandKit) return "";
  const identity = `${field.key} ${field.label}`.toLowerCase();
  if (/agency|business|brand|company/.test(identity) && /name/.test(identity)) {
    return (brandKit.identity.tradingName || brandKit.identity.businessName || "").trim();
  }
  if (/phone|telephone|mobile/.test(identity)) return brandKit.contact.phone?.trim() || "";
  if (/email/.test(identity)) return brandKit.contact.email?.trim() || "";
  if (/website|web url|site url|domain/.test(identity)) return brandKit.source.url?.trim() || "";
  return "";
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
