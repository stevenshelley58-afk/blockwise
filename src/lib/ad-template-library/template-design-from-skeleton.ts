import {
  templateDesignSchema,
  type TemplateDesign,
  type TemplateDesignSet,
  type TemplateLayer,
} from "../adstudio/template-design.ts";
import type { AdStudioFormat } from "../adstudio/types.ts";

import type { CreativeSkeleton } from "./skeleton.ts";

const CANVAS_BY_FORMAT: Record<AdStudioFormat, { w: number; h: number }> = {
  "1:1": { w: 1080, h: 1080 },
  "4:5": { w: 1080, h: 1350 },
  "9:16": { w: 1080, h: 1920 },
  "1.91:1": { w: 1200, h: 628 },
};

const DEFAULT_FORMATS: AdStudioFormat[] = ["9:16", "4:5", "1:1", "1.91:1"];
const DEFAULT_PALETTE = ["#14314F", "#FFFFFF", "#E7B24B", "#0B1720"];
const DEFAULT_FONTS = ["Inter", "Inter"];

type SkeletonRect = {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SkeletonTemplateDesignInput = {
  templateId: string;
  skeleton: CreativeSkeleton;
  format: AdStudioFormat;
  version?: number;
  fonts?: string[];
  palette?: string[];
};

export type SkeletonTemplateDesignSetInput = Omit<SkeletonTemplateDesignInput, "format"> & {
  formats?: AdStudioFormat[];
};

export function templateDesignFromCreativeSkeleton(input: SkeletonTemplateDesignInput): TemplateDesign {
  const palette = normalisePalette(input.palette ?? input.skeleton.color.palette);
  const fonts = normaliseFonts(input.fonts);
  const imageSlots = templateImageSlots(input.skeleton, input.format);
  const primaryZone = primaryCopyZone(input.skeleton);
  const panel = inflateRect(primaryZone, 0.026, 0.026);
  const cta = ctaRect(input.skeleton, panel);
  const sizes = textSizes(input.format);
  const textX = clamp(panel.x + Math.min(0.04, panel.w * 0.1));
  const textW = clampLength(panel.w - (textX - panel.x) * 2, 0.12);
  const textTop = clamp(panel.y + Math.min(0.045, panel.h * 0.14));
  const headlineTop = clamp(textTop + Math.min(0.06, panel.h * 0.2));
  const subheadTop = clamp(headlineTop + Math.min(0.13, panel.h * 0.36));

  const layers: TemplateLayer[] = [
    {
      id: "background",
      type: "shape",
      rect: { x: 0, y: 0, w: 1, h: 1 },
      fill: palette[0] ?? DEFAULT_PALETTE[0],
      role: "background",
      locked: true,
    },
    ...imageSlots.map((slot): TemplateLayer => ({
      id: slot.id || "primary_photo",
      type: "image_slot",
      rect: toTemplateRect(slot),
      role: slot.role ?? "primary",
      fit: "smart",
      mask: slot.role === "agent_headshot" ? "circle" : "none",
      editorLabel: imageLabel(slot.id, slot.role),
      guidance: slot.prompt_hint ?? imageGuidance(slot.role),
      required: true,
    })),
    {
      id: "photo_scrim",
      type: "shape",
      rect: { x: 0, y: 0, w: 1, h: 1 },
      fill: "#0B1720",
      opacity: input.skeleton.color.contrast === "low" ? 0.1 : 0.18,
      role: "scrim",
      locked: true,
    },
    {
      id: "copy_panel",
      type: "shape",
      rect: toTemplateRect(panel),
      fill: palette[1] ?? DEFAULT_PALETTE[1],
      radius: roundedRadius(input.format),
      opacity: 0.92,
      role: "panel",
      locked: true,
    },
    {
      id: "eyebrow",
      type: "text",
      rect: rectFromEdges(textX, textTop, textX + textW, textTop + Math.min(0.05, panel.h * 0.18)),
      slot: "eyebrow",
      align: "left",
      font: fonts[0] ?? DEFAULT_FONTS[0],
      size: sizes.eyebrow,
      lineHeight: 1.05,
      weight: 800,
      color: palette[2] ?? DEFAULT_PALETTE[2],
      case: "upper",
      maxChars: 44,
      fill: "static",
      text: input.skeleton.copy.hook_style,
    },
    {
      id: "headline",
      type: "text",
      rect: rectFromEdges(textX, headlineTop, textX + textW, headlineTop + Math.min(0.14, panel.h * 0.36)),
      slot: "headline",
      align: "left",
      font: fonts[0] ?? DEFAULT_FONTS[0],
      size: sizes.headline,
      lineHeight: 1.04,
      weight: 900,
      color: palette[3] ?? DEFAULT_PALETTE[3],
      maxChars: 62,
      fill: "ai_copy",
    },
    {
      id: "subhead",
      type: "text",
      rect: rectFromEdges(textX, subheadTop, textX + textW, subheadTop + Math.min(0.09, panel.h * 0.24)),
      slot: "subhead",
      align: "left",
      font: fonts[1] ?? fonts[0] ?? DEFAULT_FONTS[1],
      size: sizes.subhead,
      lineHeight: 1.18,
      weight: 600,
      color: "#24364A",
      maxChars: 130,
      fill: "ai_copy",
    },
    {
      id: "cta",
      type: "cta_button",
      rect: toTemplateRect(cta),
      fill: palette[0] ?? DEFAULT_PALETTE[0],
      radius: 999,
      label: "cta",
      textColor: "#FFFFFF",
      font: fonts[1] ?? fonts[0] ?? DEFAULT_FONTS[1],
      size: sizes.cta,
    },
  ];

  return templateDesignSchema.parse({
    templateId: input.templateId,
    version: input.version ?? input.skeleton.version,
    format: input.format,
    canvas: CANVAS_BY_FORMAT[input.format],
    palette,
    fonts,
    layers,
  });
}

export function templateDesignSetFromCreativeSkeleton(input: SkeletonTemplateDesignSetInput): TemplateDesignSet {
  const designs: TemplateDesignSet = {};
  for (const format of input.formats ?? DEFAULT_FORMATS) {
    designs[format] = templateDesignFromCreativeSkeleton({ ...input, format });
  }
  return designs;
}

function templateImageSlots(
  skeleton: CreativeSkeleton,
  format: AdStudioFormat,
): Array<SkeletonRect & { role: "primary" | "secondary" | "agent_headshot"; prompt_hint?: string }> {
  const frames = (skeleton.composition.image_frames ?? []).filter((candidate) => !candidate.formats || candidate.formats.includes(format));
  if (frames.length === 0) return [{ id: "primary_photo", role: "primary", x: 0, y: 0, width: 1, height: 1 }];
  return frames.map((frame) => ({
    id: frame.id,
    role: frame.role,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    prompt_hint: frame.prompt_hint,
  }));
}

function imageLabel(id: string | undefined, role: "primary" | "secondary" | "agent_headshot"): string {
  if (role === "primary") return "Primary property image";
  if (role === "agent_headshot") return "Agent headshot";
  if (id?.includes("secondary")) return "Secondary property image";
  return "Supporting property image";
}

function imageGuidance(role: "primary" | "secondary" | "agent_headshot"): string {
  if (role === "primary") return "Use the strongest property image for this template frame.";
  if (role === "agent_headshot") return "Use a professional agent portrait with clear eye contact.";
  return "Use a supporting property detail or alternate angle.";
}

function primaryCopyZone(skeleton: CreativeSkeleton): SkeletonRect {
  const zone =
    skeleton.composition.copy_safe_zones.find((candidate) => candidate.priority === "primary") ??
    skeleton.composition.copy_safe_zones[0];
  return zone ?? { id: "copy_panel", x: 0.08, y: 0.48, width: 0.68, height: 0.3 };
}

function ctaRect(skeleton: CreativeSkeleton, panel: Rect): Rect {
  const zone = skeleton.composition.copy_safe_zones.find((candidate) => candidate.priority === "cta");
  if (zone) return fitRect(zone, 0.16, 0.05);

  const width = Math.min(0.36, Math.max(0.18, panel.w * 0.56));
  const height = Math.min(0.07, Math.max(0.045, panel.h * 0.19));
  return fitRect({
    x: panel.x + Math.min(0.04, panel.w * 0.1),
    y: panel.y + panel.h - height - Math.min(0.035, panel.h * 0.12),
    width,
    height,
  }, width, height);
}

type Rect = { x: number; y: number; w: number; h: number };

function inflateRect(rect: SkeletonRect, padX: number, padY: number): Rect {
  const x = clamp(rect.x - padX);
  const y = clamp(rect.y - padY);
  const right = clamp(rect.x + rect.width + padX);
  const bottom = clamp(rect.y + rect.height + padY);
  return { x, y, w: clampLength(right - x, 0.12), h: clampLength(bottom - y, 0.12) };
}

function fitRect(rect: SkeletonRect, minWidth: number, minHeight: number): Rect {
  const x = clamp(rect.x);
  const y = clamp(rect.y);
  const w = clampLength(Math.max(rect.width, minWidth), minWidth, 1 - x);
  const h = clampLength(Math.max(rect.height, minHeight), minHeight, 1 - y);
  return { x, y, w, h };
}

function toTemplateRect(rect: SkeletonRect | Rect): { x: number; y: number; w: number; h: number } {
  if ("w" in rect) return rect;
  return fitRect(rect, 0.05, 0.05);
}

function rectFromEdges(left: number, top: number, right: number, bottom: number): Rect {
  const x = clamp(left);
  const y = clamp(top);
  const w = clampLength(clamp(right) - x, 0.05, 1 - x);
  const h = clampLength(clamp(bottom) - y, 0.03, 1 - y);
  return { x, y, w, h };
}

function normalisePalette(values: string[] | undefined): string[] {
  const hex = (values ?? []).map(resolveColour).filter((value): value is string => Boolean(value));
  return [...hex, ...DEFAULT_PALETTE].filter((value, index, all) => all.indexOf(value) === index).slice(0, 8);
}

function resolveColour(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/iu.test(trimmed)) return trimmed;
  if (/white|paper|neutral/iu.test(trimmed)) return "#FFFFFF";
  if (/accent|gold|yellow|signal/iu.test(trimmed)) return "#E7B24B";
  if (/charcoal|text|black|dark/iu.test(trimmed)) return "#0B1720";
  return "#14314F";
}

function normaliseFonts(values: string[] | undefined): string[] {
  const fonts = (values ?? []).map((value) => value.trim()).filter(Boolean);
  return [...fonts, ...DEFAULT_FONTS].filter((value, index, all) => all.indexOf(value) === index).slice(0, 4);
}

function textSizes(format: AdStudioFormat) {
  if (format === "1.91:1") return { eyebrow: 20, headline: 38, subhead: 20, cta: 20 };
  if (format === "9:16") return { eyebrow: 30, headline: 58, subhead: 30, cta: 26 };
  return { eyebrow: 28, headline: 52, subhead: 28, cta: 24 };
}

function roundedRadius(format: AdStudioFormat): number {
  return format === "1.91:1" ? 18 : 24;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, round(value)));
}

function clampLength(value: number, min: number, max = 1): number {
  return Math.min(max, Math.max(min, round(value)));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
