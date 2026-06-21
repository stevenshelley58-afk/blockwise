import { EXTRACTED_META_TEMPLATE_DESCRIPTORS } from "./extracted-meta-templates.generated.ts";
import type { TemplateDesign, TemplateDesignSet, TemplateLayer, TemplateRect } from "./template-design.ts";
import type { AdStudioTemplate } from "./templates.ts";
import type { AdStudioTemplateSampleStyle } from "./template-samples.ts";
import type { AdStudioFormat } from "./types.ts";

const META_TEMPLATE_FORMATS = ["9:16", "4:5", "1:1"] as const satisfies readonly AdStudioFormat[];
type MetaTemplateFormat = (typeof META_TEMPLATE_FORMATS)[number];

const CANVAS_BY_FORMAT = {
  "9:16": { w: 1080, h: 1920 },
  "4:5": { w: 1080, h: 1350 },
  "1:1": { w: 1080, h: 1080 },
} as const satisfies Record<MetaTemplateFormat, { w: number; h: number }>;

type ExtractedMetaDescriptor = (typeof EXTRACTED_META_TEMPLATE_DESCRIPTORS)[number];

export const EXTRACTED_META_AD_STUDIO_TEMPLATES: AdStudioTemplate[] =
  EXTRACTED_META_TEMPLATE_DESCRIPTORS.map(templateFromDescriptor);

function templateFromDescriptor(descriptor: ExtractedMetaDescriptor): AdStudioTemplate {
  return {
    id: descriptor.id,
    templateKey: descriptor.id,
    name: descriptor.name,
    goal: descriptor.goal,
    offerId: descriptor.offerId,
    imageBriefId: descriptor.imageBriefId,
    promptHint: descriptor.promptHint,
    source: "radar",
    status: "approved",
    sampleCopy: {
      headline: descriptor.sampleCopy.headline,
      primaryText: descriptor.sampleCopy.primaryText,
      description: descriptor.sampleCopy.description,
      cta: descriptor.sampleCopy.cta,
    },
    sampleStyle: sampleStyleFromDescriptor(descriptor),
    designs: designSetFromDescriptor(descriptor),
    evidenceScore: descriptor.evidenceScore,
    winnerRationale:
      `Extracted individual Meta candidate ${descriptor.id} from ${descriptor.sourceFile}; original source ${descriptor.originalFile}.`,
    complianceNote:
      "Editable real estate ad template generated from extracted candidate layout metadata; copy stays compliant and outcome-neutral.",
    exemplars: [descriptor.sourceFile, descriptor.originalFile],
  };
}

function sampleStyleFromDescriptor(descriptor: ExtractedMetaDescriptor): AdStudioTemplateSampleStyle {
  return {
    version: "template-samples-v1",
    propertyAge: descriptor.sampleStyle.propertyAge,
    priceFeel: descriptor.sampleStyle.priceFeel,
    visualStyle: descriptor.sampleStyle.visualStyle,
    people: descriptor.sampleStyle.people,
    copyDensity: descriptor.sampleStyle.copyDensity,
    tone: descriptor.sampleStyle.tone,
    sampleSuburb: descriptor.sampleStyle.sampleSuburb,
    sampleState: "WA",
    agencyName: descriptor.sampleStyle.agencyName,
    agentName: descriptor.sampleStyle.agentName,
    address: descriptor.sampleStyle.address,
    propertyDetail: descriptor.sampleStyle.propertyDetail,
    resultDetail: descriptor.sampleStyle.resultDetail,
    sampleCardImagePath: `extracted-meta/${descriptor.id}.svg`,
  };
}

function designSetFromDescriptor(descriptor: ExtractedMetaDescriptor): TemplateDesignSet {
  return Object.fromEntries(
    META_TEMPLATE_FORMATS.map((format) => [format, designFromDescriptor(descriptor, format)]),
  ) as TemplateDesignSet;
}

function designFromDescriptor(descriptor: ExtractedMetaDescriptor, format: MetaTemplateFormat): TemplateDesign {
  const photoRect = photoRectForFormat(descriptor, format);
  const panelRect = panelRectForFormat(descriptor, format);
  const palette = paletteForDescriptor(descriptor);
  const textColor = "#FFFFFF";
  const mutedTextColor = "#D7E2EA";
  const accent = accentForDescriptor(descriptor);
  const text = textRects(panelRect);
  const sizes = textSizes(format);

  const layers: TemplateLayer[] = [
    {
      id: "background",
      type: "shape",
      rect: fullRect(),
      fill: palette[0],
      role: "background",
      locked: true,
    },
    {
      id: "primary_photo",
      type: "image_slot",
      rect: photoRect,
      role: "primary",
      fit: "smart",
      mask: descriptor.kind === "agent" ? "shape" : "none",
    },
    ...secondaryPhotoLayers(descriptor, format),
    {
      id: "photo_scrim",
      type: "shape",
      rect: panelRect,
      fill: "#07111C",
      opacity: 0.82,
      radius: 28,
      role: "scrim",
    },
    {
      id: "logo",
      type: "logo",
      rect: logoRectForFormat(format),
      source: "brand_kit",
    },
    {
      id: "eyebrow",
      type: "text",
      rect: text.eyebrow,
      slot: "eyebrow",
      align: "left",
      font: "Inter, Arial, sans-serif",
      size: sizes.eyebrow,
      lineHeight: 1,
      weight: 800,
      color: accent,
      letterSpacing: 0,
      case: "upper",
      maxChars: 34,
      fill: "static",
      text: eyebrowForDescriptor(descriptor),
    },
    {
      id: "headline",
      type: "text",
      rect: text.headline,
      slot: "headline",
      align: "left",
      font: "Inter, Arial, sans-serif",
      size: sizes.headline,
      lineHeight: 1.04,
      weight: 900,
      color: textColor,
      letterSpacing: 0,
      maxChars: headlineLimit(format),
      fill: "ai_copy",
    },
    {
      id: "body",
      type: "text",
      rect: text.body,
      slot: "body",
      align: "left",
      font: "Inter, Arial, sans-serif",
      size: sizes.body,
      lineHeight: 1.18,
      weight: 600,
      color: mutedTextColor,
      letterSpacing: 0,
      maxChars: bodyLimit(format),
      fill: "ai_copy",
    },
    {
      id: "address",
      type: "text",
      rect: text.address,
      slot: "address",
      align: "left",
      font: "Inter, Arial, sans-serif",
      size: sizes.address,
      lineHeight: 1,
      weight: 700,
      color: "#F4F7FA",
      letterSpacing: 0,
      maxChars: 42,
      fill: "static",
      text: descriptor.sampleStyle.address,
    },
    {
      id: "cta",
      type: "cta_button",
      rect: text.cta,
      fill: accent,
      radius: 999,
      label: "cta",
      textColor: "#0B1720",
      font: "Inter, Arial, sans-serif",
      size: sizes.cta,
    },
  ];

  return {
    templateId: descriptor.id,
    version: 1,
    format,
    canvas: CANVAS_BY_FORMAT[format],
    palette,
    fonts: ["Inter, Arial, sans-serif", "Inter, Arial, sans-serif"],
    layers,
  };
}

function secondaryPhotoLayers(descriptor: ExtractedMetaDescriptor, format: MetaTemplateFormat): TemplateLayer[] {
  if (format !== descriptor.nativeFormat) return [];
  return descriptor.photoRects.slice(1, 3).map((sourceRect, index) => ({
    id: `secondary_photo_${index + 1}`,
    type: "image_slot",
    rect: normaliseRect(sourceRect),
    role: "secondary",
    fit: "smart",
    mask: "none",
  }));
}

function paletteForDescriptor(descriptor: ExtractedMetaDescriptor): string[] {
  const unique = [...new Set(descriptor.palette)];
  return [...unique, "#0B1720", "#FFFFFF", "#E7C46A"].slice(0, 8);
}

function accentForDescriptor(descriptor: ExtractedMetaDescriptor): string {
  const [primary, secondary, third] = descriptor.palette;
  const candidate = [secondary, third, primary].find((value) => value && value.toUpperCase() !== "#FFFFFF");
  return candidate ?? "#E7C46A";
}

function eyebrowForDescriptor(descriptor: ExtractedMetaDescriptor): string {
  return `${descriptor.id.replace("_", " ")} / ${descriptor.kind.replace(/_/gu, " ")}`;
}

function photoRectForFormat(descriptor: ExtractedMetaDescriptor, format: MetaTemplateFormat): TemplateRect {
  if (format === descriptor.nativeFormat) return normaliseRect(descriptor.photoRects[0]);
  if (format === "9:16") return rect(0, 0, 1, 1);
  if (format === "4:5") return rect(0.06, 0.05, 0.88, 0.56);
  return rect(0.06, 0.06, 0.88, 0.56);
}

function panelRectForFormat(descriptor: ExtractedMetaDescriptor, format: MetaTemplateFormat): TemplateRect {
  if (format === descriptor.nativeFormat) return normaliseRect(descriptor.panelRect);
  if (format === "9:16") return rect(0.07, 0.6, 0.86, 0.31);
  if (format === "4:5") return rect(0.08, 0.65, 0.84, 0.27);
  return rect(0.08, 0.64, 0.84, 0.29);
}

function logoRectForFormat(format: MetaTemplateFormat): TemplateRect {
  if (format === "9:16") return rect(0.07, 0.045, 0.28, 0.045);
  return rect(0.07, 0.055, 0.28, 0.055);
}

function textRects(panel: TemplateRect) {
  const insetX = panel.w * 0.075;
  const x = panel.x + insetX;
  const w = panel.w - insetX * 2;
  return {
    eyebrow: rect(x, panel.y + panel.h * 0.09, w, panel.h * 0.11),
    headline: rect(x, panel.y + panel.h * 0.24, w, panel.h * 0.24),
    body: rect(x, panel.y + panel.h * 0.51, w, panel.h * 0.17),
    address: rect(x, panel.y + panel.h * 0.7, w * 0.58, panel.h * 0.12),
    cta: rect(x + w * 0.57, panel.y + panel.h * 0.7, w * 0.43, panel.h * 0.14),
  };
}

function textSizes(format: MetaTemplateFormat) {
  if (format === "1:1") return { eyebrow: 25, headline: 46, body: 25, address: 20, cta: 20 };
  if (format === "4:5") return { eyebrow: 26, headline: 52, body: 27, address: 22, cta: 22 };
  return { eyebrow: 28, headline: 58, body: 30, address: 24, cta: 24 };
}

function headlineLimit(format: MetaTemplateFormat): number {
  if (format === "1:1") return 48;
  return 56;
}

function bodyLimit(_format: MetaTemplateFormat): number {
  return 92;
}

function fullRect(): TemplateRect {
  return { x: 0, y: 0, w: 1, h: 1 };
}

function normaliseRect(source: { x: number; y: number; w: number; h: number } | undefined): TemplateRect {
  if (!source) return fullRect();
  return rect(source.x, source.y, source.w, source.h);
}

function rect(x: number, y: number, w: number, h: number): TemplateRect {
  const safeX = clamp(x);
  const safeY = clamp(y);
  const safeW = clamp(w, 0.02, 1 - safeX);
  const safeH = clamp(h, 0.02, 1 - safeY);
  return {
    x: round4(safeX),
    y: round4(safeY),
    w: round4(safeW),
    h: round4(safeH),
  };
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
