import type { AdStudioTemplate } from "./templates.ts";
import type { TemplateDesign, TemplateRect, TextCopyField, TextSlot } from "./template-design.ts";
import type { AdStudioFormat } from "./types.ts";

export type TemplateTextSlot = {
  id: string;
  sourceLayerId: string;
  slot: TextSlot;
  copyField: TextCopyField;
  label: string;
  guidance: string;
  maxChars: number;
  maxLines: number;
  rect: TemplateRect;
  previewFormat: AdStudioFormat;
  source: "design" | "fallback";
  editable: boolean;
};

type TemplateTextSlotTemplate = Pick<AdStudioTemplate, "designs">;

type ResolveTemplateTextSlotsInput = {
  template?: TemplateTextSlotTemplate | null;
  preferredFormat?: AdStudioFormat;
};

const FORMAT_ORDER: AdStudioFormat[] = ["4:5", "9:16", "1:1", "1.91:1"];
const FALLBACK_RECT: TemplateRect = { x: 0.08, y: 0.65, w: 0.84, h: 0.16 };

export function resolveTemplateTextSlots({
  template,
  preferredFormat = "4:5",
}: ResolveTemplateTextSlotsInput = {}): TemplateTextSlot[] {
  const slots = new Map<string, TemplateTextSlot>();
  for (const design of orderedDesigns(template, preferredFormat)) {
    for (const layer of design.layers) {
      if (layer.type === "text") {
        const key = `${layer.id}:${layer.slot}`;
        if (slots.has(key)) continue;
        slots.set(key, {
          id: key,
          sourceLayerId: layer.id,
          slot: layer.slot,
          copyField: layer.copyField ?? copyFieldForTextLayer(layer.slot, layer.fill),
          label: layer.editorLabel ?? labelForSlot(layer.slot),
          guidance: layer.guidance ?? guidanceForSlot(layer.slot),
          maxChars: layer.maxChars ?? defaultMaxChars(layer.slot),
          maxLines: layer.maxLines ?? defaultMaxLines(layer.slot),
          rect: layer.rect,
          previewFormat: design.format,
          source: "design",
          editable: layer.fill === "ai_copy",
        });
        continue;
      }

      if (layer.type === "cta_button") {
        const key = `${layer.id}:${layer.label}`;
        if (slots.has(key)) continue;
        slots.set(key, {
          id: key,
          sourceLayerId: layer.id,
          slot: layer.label,
          copyField: layer.copyField ?? "cta",
          label: layer.editorLabel ?? "CTA",
          guidance: layer.guidance ?? "Short button label that fits inside the CTA button.",
          maxChars: layer.maxChars ?? 24,
          maxLines: layer.maxLines ?? 1,
          rect: layer.rect,
          previewFormat: design.format,
          source: "design",
          editable: true,
        });
      }
    }
  }

  if (slots.size > 0) return [...slots.values()];
  return [
    {
      id: "headline:headline",
      sourceLayerId: "headline",
      slot: "headline",
      copyField: "headline",
      label: "Headline",
      guidance: "Main visible headline for the creative.",
      maxChars: 40,
      maxLines: 2,
      rect: FALLBACK_RECT,
      previewFormat: preferredFormat,
      source: "fallback",
      editable: true,
    },
  ];
}

function orderedDesigns(
  template: TemplateTextSlotTemplate | null | undefined,
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

function copyFieldForTextLayer(slot: TextSlot, fill: "ai_copy" | "brand" | "static"): TextCopyField {
  if (fill === "brand") return "brand";
  if (fill === "static") return "static";
  if (slot === "headline") return "headline";
  if (slot === "cta") return "cta";
  if (slot === "body" || slot === "subhead") return "description";
  return "static";
}

function labelForSlot(slot: TextSlot): string {
  if (slot === "headline") return "Hero headline";
  if (slot === "body" || slot === "subhead") return "Supporting copy";
  if (slot === "cta") return "CTA";
  if (slot === "eyebrow") return "Eyebrow";
  if (slot === "address") return "Location label";
  if (slot === "stat") return "Stat";
  if (slot === "phone") return "Phone";
  if (slot === "handle") return "Social handle";
  if (slot === "price") return "Price";
  return "Text";
}

function guidanceForSlot(slot: TextSlot): string {
  if (slot === "headline") return "Keep this short enough to stay inside the hero text frame.";
  if (slot === "body" || slot === "subhead") return "Short supporting message for the visible creative.";
  if (slot === "cta") return "Short button label.";
  if (slot === "address") return "Short location or address label.";
  if (slot === "stat") return "Compact proof point or property detail.";
  return "Template-controlled text.";
}

function defaultMaxChars(slot: TextSlot): number {
  if (slot === "headline") return 60;
  if (slot === "body" || slot === "subhead") return 95;
  if (slot === "cta") return 24;
  if (slot === "eyebrow") return 32;
  if (slot === "address") return 36;
  if (slot === "stat") return 28;
  if (slot === "phone") return 24;
  if (slot === "handle") return 24;
  return 60;
}

function defaultMaxLines(slot: TextSlot): number {
  if (slot === "headline") return 2;
  if (slot === "body" || slot === "subhead") return 2;
  return 1;
}
