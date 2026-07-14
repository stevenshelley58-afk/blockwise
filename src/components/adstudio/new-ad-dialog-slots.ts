import type { AdStudioTemplate } from "../../lib/adstudio/index.ts";
import type { AdStudioBrandKit, AdStudioCanvasObject } from "../../lib/adstudio/types.ts";

export type TemplateImageRequirementRole = "primary" | "secondary" | "agent_headshot";

export type TemplateImageRequirement = {
  id: string;
  label: string;
  guidance?: string;
  role: TemplateImageRequirementRole;
  required: boolean;
};

export const DEFAULT_IMAGE_SLOT: TemplateImageRequirement = {
  id: "primary_photo",
  label: "Property image",
  role: "primary",
  required: true,
};

export type TemplateCopyRequirement = {
  key: string;
  label: string;
  maxLength: number;
  /** The reference ad's own text — shown as the placeholder, never submitted. */
  sample: string;
};

/** Use the approved Brand Studio logo for declared logo slots by default. */
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

/**
 * Copy fields the CUSTOMER types verbatim (price, address, phone…), declared
 * on the template's text objects via customerSupplied. These render as
 * explicit inputs in the brief step — the fix for AI-invented facts.
 */
export function customerCopyFieldsForTemplate(
  template: AdStudioTemplate | undefined,
): TemplateCopyRequirement[] {
  const objects = template?.canvas?.objects ?? [];
  return objects
    .filter(
      (object) =>
        object.type === "text" &&
        (object as { customerSupplied?: boolean }).customerSupplied === true &&
        typeof object.content === "string",
    )
    .map((object) => {
      const sample = String(object.content).trim();
      return {
        key: object.role || object.objectId,
        label: labelize(object.role || object.objectId),
        maxLength: Math.max(sample.length + 8, 16),
        sample,
      };
    });
}

export function imageRequirementsForTemplate(
  template: AdStudioTemplate | undefined,
): TemplateImageRequirement[] {
  if (!template?.canvas?.objects?.length) return [DEFAULT_IMAGE_SLOT];

  const imageObjects = template.canvas.objects.filter((object) => object.type === "image");
  if (!imageObjects.length) return [DEFAULT_IMAGE_SLOT];

  const roleCounts = countRoles(imageObjects);
  const maxArea = Math.max(...imageObjects.map(slotArea));
  const requirements = imageObjects.map((object, index) => {
    const role = object.role.trim();
    const id = role && roleCounts.get(role) === 1 ? role : object.objectId;
    return {
      id,
      label: labelForImageSlot(object, index, imageObjects.length),
      guidance: guidanceForImageSlot(object),
      role: requirementRoleForSlot(object, index),
      required: !isOptionalImageSlot(object, maxArea),
    };
  });

  if (requirements.some((slot) => slot.required)) return requirements;

  let primaryIndex = 0;
  let primaryArea = -1;
  imageObjects.forEach((object, index) => {
    const area = slotArea(object);
    if (area > primaryArea) {
      primaryIndex = index;
      primaryArea = area;
    }
  });

  return requirements.map((slot, index) => (index === primaryIndex ? { ...slot, required: true } : slot));
}

function countRoles(objects: AdStudioCanvasObject[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const object of objects) {
    const role = object.role.trim();
    if (!role) continue;
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return counts;
}

function slotArea(object: AdStudioCanvasObject): number {
  return Math.max(0, object.width) * Math.max(0, object.height ?? 0);
}

function isOptionalImageSlot(object: AdStudioCanvasObject, maxArea: number): boolean {
  const role = object.role.toLowerCase();
  const area = slotArea(object);
  return /agent|avatar|headshot|logo|portrait|profile/u.test(role) && area < maxArea;
}

function requirementRoleForSlot(object: AdStudioCanvasObject, index: number): TemplateImageRequirementRole {
  const role = object.role.toLowerCase();
  if (/agent|avatar|headshot|portrait|profile/u.test(role)) return "agent_headshot";
  return index === 0 || /hero|main|primary/u.test(role) ? "primary" : "secondary";
}

function labelForImageSlot(object: AdStudioCanvasObject, index: number, slotCount: number): string {
  const role = object.role.toLowerCase();
  if (/agent|avatar|headshot|portrait|profile/u.test(role)) return "Agent headshot";
  if (/logo/u.test(role)) return "Logo image";
  if (/hero|main|primary/u.test(role)) return "Primary property image";
  if (/property|listing|photo|image/u.test(role)) {
    return slotCount === 1 || index === 0 ? "Property image" : `Property image ${index + 1}`;
  }
  return labelize(object.role || object.objectId);
}

function guidanceForImageSlot(object: AdStudioCanvasObject): string {
  const aspect = object.width / Math.max(1, object.height ?? object.width);
  const shape = object.clip === "circle" ? "circular" : aspect > 1.15 ? "landscape" : aspect < 0.87 ? "portrait" : "square";
  return `${capitalize(shape)} slot`;
}

function labelize(value: string): string {
  const label = value.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()).trim();
  return label || "Image";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
