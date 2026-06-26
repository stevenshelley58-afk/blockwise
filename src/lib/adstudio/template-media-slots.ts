import type { AdStudioTemplate } from "./templates.ts";
import type { TemplateDesign, TemplateRect } from "./template-design.ts";
import type { AdStudioBrandKit, AdStudioFormat } from "./types.ts";

export type TemplateMediaSlotRole = "primary" | "secondary" | "agent_headshot";

export type TemplateMediaSlot = {
  id: string;
  role: TemplateMediaSlotRole;
  label: string;
  description: string;
  required: boolean;
  defaultUrl?: string;
  rect: TemplateRect;
  previewFormat: AdStudioFormat;
  source: "design" | "skeleton" | "fallback";
};

type TemplateMediaSlotTemplate = Pick<AdStudioTemplate, "creativeSkeleton" | "designs">;

type ResolveTemplateMediaSlotsInput = {
  template?: TemplateMediaSlotTemplate | null;
  brandKit?: Pick<AdStudioBrandKit, "assets"> | null;
  preferredFormat?: AdStudioFormat;
};

const FORMAT_ORDER: AdStudioFormat[] = ["4:5", "9:16", "1:1", "1.91:1"];
const FALLBACK_RECT: TemplateRect = { x: 0, y: 0, w: 1, h: 1 };

export function resolveTemplateMediaSlots({
  template,
  brandKit,
  preferredFormat = "4:5",
}: ResolveTemplateMediaSlotsInput = {}): TemplateMediaSlot[] {
  const headshotUrl = firstHeadshotUrl(brandKit);
  const designSlots = slotsFromDesigns(template, preferredFormat, headshotUrl);
  if (designSlots.length > 0) return designSlots;

  const skeletonSlots = slotsFromSkeleton(template, preferredFormat, headshotUrl);
  if (skeletonSlots.length > 0) return skeletonSlots;

  return [
    buildSlot({
      id: "primary_photo",
      role: "primary",
      rect: FALLBACK_RECT,
      index: 0,
      previewFormat: preferredFormat,
      source: "fallback",
      headshotUrl,
    }),
  ];
}

function slotsFromDesigns(
  template: TemplateMediaSlotTemplate | null | undefined,
  preferredFormat: AdStudioFormat,
  headshotUrl: string | undefined,
): TemplateMediaSlot[] {
  const slots = new Map<string, TemplateMediaSlot>();
  for (const design of orderedDesigns(template, preferredFormat)) {
    for (const layer of design.layers) {
      if (layer.type !== "image_slot" || slots.has(layer.id)) continue;
      slots.set(layer.id, buildSlot({
        id: layer.id,
        role: layer.role,
        rect: layer.rect,
        index: slots.size,
        previewFormat: design.format,
        source: "design",
        headshotUrl,
      }));
    }
  }
  return [...slots.values()];
}

function slotsFromSkeleton(
  template: TemplateMediaSlotTemplate | null | undefined,
  preferredFormat: AdStudioFormat,
  headshotUrl: string | undefined,
): TemplateMediaSlot[] {
  const slots = new Map<string, TemplateMediaSlot>();
  for (const format of orderedFormats(preferredFormat)) {
    for (const frame of template?.creativeSkeleton?.composition.image_frames ?? []) {
      if (frame.formats && !frame.formats.includes(format)) continue;
      if (slots.has(frame.id)) continue;
      slots.set(frame.id, buildSlot({
        id: frame.id,
        role: frame.role,
        rect: { x: frame.x, y: frame.y, w: frame.width, h: frame.height },
        index: slots.size,
        previewFormat: format,
        source: "skeleton",
        headshotUrl,
      }));
    }
  }
  return [...slots.values()];
}

function orderedDesigns(
  template: TemplateMediaSlotTemplate | null | undefined,
  preferredFormat: AdStudioFormat,
): TemplateDesign[] {
  const designs = template?.designs ?? {};
  return orderedFormats(preferredFormat)
    .map((format) => designs[format])
    .filter((design): design is TemplateDesign => Boolean(design));
}

function orderedFormats(preferredFormat: AdStudioFormat): AdStudioFormat[] {
  return [preferredFormat, ...FORMAT_ORDER.filter((format) => format !== preferredFormat)];
}

function buildSlot(input: {
  id: string;
  role: TemplateMediaSlotRole;
  rect: TemplateRect;
  index: number;
  previewFormat: AdStudioFormat;
  source: TemplateMediaSlot["source"];
  headshotUrl: string | undefined;
}): TemplateMediaSlot {
  const defaultUrl = input.role === "agent_headshot" ? input.headshotUrl : undefined;
  return {
    id: input.id,
    role: input.role,
    label: slotLabel(input.id, input.role, input.rect, input.index),
    description: slotDescription(input.role, input.rect, Boolean(defaultUrl)),
    required: input.role === "agent_headshot" ? !defaultUrl : true,
    ...(defaultUrl ? { defaultUrl } : {}),
    rect: input.rect,
    previewFormat: input.previewFormat,
    source: input.source,
  };
}

function firstHeadshotUrl(brandKit: Pick<AdStudioBrandKit, "assets"> | null | undefined): string | undefined {
  return brandKit?.assets.headshots.find((url) => url.trim().length > 0);
}

function slotLabel(id: string, role: TemplateMediaSlotRole, rect: TemplateRect, index: number): string {
  if (role === "agent_headshot") return "Agent headshot";
  if (role === "primary") return "Hero image";

  const semantic = semanticSecondaryLabel(id, rect);
  if (semantic) return semantic;

  const normalised = id.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()).trim();
  return normalised || `Supporting image ${index + 1}`;
}

function semanticSecondaryLabel(id: string, rect: TemplateRect): string {
  const normalized = id.toLowerCase();
  if (/top|upper|one|hero/.test(normalized)) return "Upper inset image";
  if (/mid|middle|two/.test(normalized)) return "Middle inset image";
  if (/low|lower|bottom|three/.test(normalized)) return "Lower inset image";
  if (rect.y < 0.3) return "Upper inset image";
  if (rect.y < 0.56) return "Middle inset image";
  return "Lower inset image";
}

function slotDescription(role: TemplateMediaSlotRole, rect: TemplateRect, hasDefault: boolean): string {
  if (role === "agent_headshot") {
    return hasDefault
      ? "Auto-filled from the brand kit. Replace it if this ad needs a different portrait."
      : "Pick or upload the agent portrait for this template.";
  }
  if (role === "primary") {
    return "Main listing photo. Best for the front elevation or strongest room.";
  }
  if (rect.y < 0.3) return "Supporting property detail for the top part of the layout.";
  if (rect.y < 0.56) return "Supporting property detail for the middle of the layout.";
  return "Supporting property detail for the lower part of the layout.";
}
