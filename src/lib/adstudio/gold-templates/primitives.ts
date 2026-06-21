import type { TemplateDesign, TemplateLayer, TemplateRect, TextSlot } from "../template-design.ts";
import type { AdStudioFormat } from "../types.ts";

export const GOLD_SAMPLE_CARD_VERSION = "gold-reference-board-v4";

export const GOLD_FORMATS = ["9:16", "4:5", "1:1"] as const satisfies readonly AdStudioFormat[];
export type GoldFormat = (typeof GOLD_FORMATS)[number];

export type GoldTemplateRenderSample = {
  photoFile: string;
  text: Partial<Record<TextSlot, string>>;
};

const CANVAS_BY_FORMAT = {
  "9:16": { w: 1080, h: 1920 },
  "4:5": { w: 1080, h: 1350 },
  "1:1": { w: 1080, h: 1080 },
} as const satisfies Record<GoldFormat, { w: number; h: number }>;

export function canvasFor(format: GoldFormat): TemplateDesign["canvas"] {
  return CANVAS_BY_FORMAT[format];
}

export function design(input: {
  templateId: string;
  format: GoldFormat;
  palette: string[];
  fonts: string[];
  layers: TemplateLayer[];
}): TemplateDesign {
  return {
    templateId: input.templateId,
    version: 4,
    format: input.format,
    canvas: canvasFor(input.format),
    palette: input.palette,
    fonts: input.fonts,
    layers: input.layers,
  };
}

export function shape(
  id: string,
  rectValue: TemplateRect,
  fill: string,
  role: Extract<TemplateLayer, { type: "shape" }>["role"],
  radius = 0,
  opacity?: number,
): TemplateLayer {
  return { id, type: "shape", rect: rectValue, fill, radius, role, ...(opacity !== undefined ? { opacity } : {}) };
}

export function image(
  id: string,
  rectValue: TemplateRect,
  role: Extract<TemplateLayer, { type: "image_slot" }>["role"],
  anchor: Extract<TemplateLayer, { type: "image_slot" }>["anchor"] = "center",
  mask: Extract<TemplateLayer, { type: "image_slot" }>["mask"] = "none",
): TemplateLayer {
  return { id, type: "image_slot", rect: rectValue, role, fit: "smart", anchor, mask };
}

export function logo(rectValue: TemplateRect): TemplateLayer {
  return { id: "logo", type: "logo", rect: rectValue, source: "brand_kit" };
}

export function text(
  id: string,
  slot: Extract<TemplateLayer, { type: "text" }>["slot"],
  rectValue: TemplateRect,
  size: number,
  color: string,
  fill: Extract<TemplateLayer, { type: "text" }>["fill"],
  staticText?: string,
  maxChars = 80,
  textCase: Extract<TemplateLayer, { type: "text" }>["case"] = "none",
  align: Extract<TemplateLayer, { type: "text" }>["align"] = "left",
  font = "Inter, Arial, sans-serif",
  weight?: number,
): TemplateLayer {
  return {
    id,
    type: "text",
    rect: rectValue,
    slot,
    align,
    font,
    size,
    lineHeight: slot === "headline" ? 1.02 : 1.14,
    weight: weight ?? (slot === "headline" ? 900 : slot === "eyebrow" || slot === "stat" ? 850 : 650),
    color,
    letterSpacing: 0,
    case: textCase,
    maxChars,
    fill,
    ...(staticText ? { text: staticText } : {}),
  };
}

export function cta(id: string, rectValue: TemplateRect, fill: string, textColor: string, size: number): TemplateLayer {
  return {
    id,
    type: "cta_button",
    rect: rectValue,
    fill,
    radius: 999,
    label: "cta" satisfies TextSlot,
    textColor,
    font: "Inter, Arial, sans-serif",
    size,
  };
}

export function rel(base: TemplateRect, x: number, y: number, w: number, h: number): TemplateRect {
  return rect(base.x + base.w * x, base.y + base.h * y, base.w * w, base.h * h);
}

export function fullRect(): TemplateRect {
  return { x: 0, y: 0, w: 1, h: 1 };
}

export function rect(x: number, y: number, w: number, h: number): TemplateRect {
  const safeX = clamp(x);
  const safeY = clamp(y);
  const safeW = clamp(w, 0.02, 1 - safeX);
  const safeH = clamp(h, 0.02, 1 - safeY);
  return { x: round4(safeX), y: round4(safeY), w: round4(safeW), h: round4(safeH) };
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
