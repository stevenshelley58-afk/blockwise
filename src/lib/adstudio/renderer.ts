import type {
  BoundTemplateContent,
  TemplateDesign,
  TemplateLayer,
  TextSlot,
} from "./template-design.ts";
import type { AdStudioBrandKit, AdStudioCanvasObject, AdStudioCreative, AdStudioFormat } from "./types.ts";

const FORMAT_SIZE: Record<AdStudioFormat, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
  "1.91:1": { width: 1200, height: 628 },
};

export function getCanvasSize(format: AdStudioFormat) {
  return FORMAT_SIZE[format];
}

export type RenderDesignOptions = {
  creativeId?: string;
  campaignId?: string;
  variantId?: string;
};

export function renderDesign(
  design: TemplateDesign,
  content: BoundTemplateContent,
  brandKit: AdStudioBrandKit,
  options: RenderDesignOptions = {},
): AdStudioCreative {
  const objects = design.layers.flatMap((layer) => layerToCanvasObjects(layer, design, content, brandKit));
  const creative: Omit<AdStudioCreative, "previewSvg"> = {
    creativeId: options.creativeId ?? `template_design:${design.templateId}:v${design.version}:${design.format}`,
    campaignId: options.campaignId ?? design.templateId,
    variantId: options.variantId ?? "template_design",
    format: design.format,
    source: "template_composite",
    canvas: {
      width: design.canvas.w,
      height: design.canvas.h,
      backgroundAssetId: null,
      objects,
    },
    safeZones: {
      metaStory: design.format === "9:16",
      googleDemandGen: true,
    },
  };

  return {
    ...creative,
    previewSvg: renderTemplateCreativeSvg(creative, brandKit),
  };
}

export function renderDesignSvg(
  design: TemplateDesign,
  content: BoundTemplateContent,
  brandKit: AdStudioBrandKit,
): string {
  return renderDesign(design, content, brandKit).previewSvg;
}

export function renderCreativeSvg(
  creative: Omit<AdStudioCreative, "previewSvg">,
  brandKit?: Pick<AdStudioBrandKit, "identity" | "typography">,
): string {
  const { width, height, objects } = creative.canvas;
  const background = objects.find((object) => object.role === "background_shape");
  const fills = {
    bg: background?.fill ?? "#F1F5F9",
    text: "#131B2E",
    accent: "#123E75",
  };
  const defs: string[] = [];
  const nodes = objects
    .filter((object) => object.type !== "safe_zone")
    .map((object) => {
      if (object.type === "text") {
        return `<text x="${object.x}" y="${object.y}" font-family="${escapeXml(svgFontFamily(object, brandKit))}" font-size="${object.size ?? 48}" font-weight="${object.role === "headline" ? 850 : 650}" fill="${escapeXml(object.fill ?? fills.text)}">${escapeXml(object.content ?? "")}</text>`;
      }

      if (object.type === "logo") {
        const height = object.height ?? object.width * 0.35;
        const src = object.assetId;

        if (src && isRenderableImageSrc(src)) {
          return `<image x="${object.x}" y="${object.y}" width="${object.width}" height="${height}" href="${escapeXml(src)}" preserveAspectRatio="xMidYMid meet"/>`;
        }

        const label = object.content ?? brandKit?.identity.tradingName ?? brandKit?.identity.businessName ?? "Brand";
        return `<rect x="${object.x}" y="${object.y}" width="${object.width}" height="${height}" rx="10" fill="${fills.text}"/><text x="${object.x + 20}" y="${object.y + height * 0.62}" font-family="${escapeXml(svgFontFamily(object, brandKit))}" font-size="${Math.max(18, Math.round(height * 0.48))}" font-weight="850" fill="#fff">${escapeXml(label)}</text>`;
      }

      if (object.type === "image") {
        const src = object.content ?? object.assetId;
        if (src && isRenderableImageSrc(src)) {
          const clip = imageClipPath(object, defs);
          return `<image x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height ?? object.width}" href="${escapeXml(src)}" preserveAspectRatio="${preserveAspectRatioForAnchor(object.imageAnchor)} slice"${clip}/>`;
        }

        return `<circle cx="${object.x + object.width / 2}" cy="${object.y + (object.height ?? object.width) / 2}" r="${Math.min(object.width, object.height ?? object.width) / 2}" fill="#D9E7E3"/><circle cx="${object.x + object.width / 2}" cy="${object.y + 46}" r="34" fill="#68746F"/><path d="M ${object.x + 38} ${object.y + 142} Q ${object.x + object.width / 2} ${object.y + 72} ${object.x + object.width - 38} ${object.y + 142} Z" fill="#68746F"/>`;
      }

      return `<rect x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height ?? object.width}" rx="18" fill="${escapeXml(object.fill ?? fills.accent)}"/>`;
    })
    .join("");

  const defsNode = defs.length ? `<defs>${defs.join("")}</defs>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${defsNode}<rect width="100%" height="100%" fill="${fills.bg}"/><circle cx="${width - 170}" cy="140" r="150" fill="#FFFFFF" opacity="0.55"/><rect x="${Math.round(width * 0.1)}" y="${Math.round(height * 0.58)}" width="${Math.round(width * 0.46)}" height="${Math.round(height * 0.22)}" rx="24" fill="#FFFFFF" opacity="0.88"/><path d="M${Math.round(width * 0.17)} ${Math.round(height * 0.58)} L${Math.round(width * 0.33)} ${Math.round(height * 0.44)} L${Math.round(width * 0.49)} ${Math.round(height * 0.58)} Z" fill="#FFFFFF" opacity="0.88"/>${nodes}</svg>`;
}

function imageClipPath(object: AdStudioCanvasObject, defs: string[]): string {
  const clip = object.clip ?? "rect";
  if (clip === "rect") return "";

  const height = object.height ?? object.width;
  const id = `clip_${object.objectId.replace(/[^a-z0-9_-]/gi, "_")}_${defs.length}`;
  if (clip === "circle") {
    defs.push(`<clipPath id="${id}"><circle cx="${object.x + object.width / 2}" cy="${object.y + height / 2}" r="${Math.min(object.width, height) / 2}"/></clipPath>`);
  } else {
    const r = object.width / 2;
    defs.push(`<clipPath id="${id}"><path d="M${object.x} ${object.y + height} V${object.y + r} A${r} ${r} 0 0 1 ${object.x + object.width} ${object.y + r} V${object.y + height} Z"/></clipPath>`);
  }
  return ` clip-path="url(#${id})"`;
}

function svgFontFamily(
  object: AdStudioCanvasObject,
  brandKit: Pick<AdStudioBrandKit, "typography"> | undefined,
): string {
  if (object.fontFamily) return object.fontFamily;

  if (object.font === "brand_heading") {
    const fallback = brandKit?.typography.fallbackHeading === "serif" ? "Georgia, serif" : "Inter, Arial, sans-serif";
    return brandKit?.typography.headingFont ? `${brandKit.typography.headingFont}, ${fallback}` : fallback;
  }

  const fallback = brandKit?.typography.fallbackBody === "serif" ? "Georgia, serif" : "Inter, Arial, sans-serif";
  return brandKit?.typography.bodyFont ? `${brandKit.typography.bodyFont}, ${fallback}` : fallback;
}

function isRenderableImageSrc(value: string): boolean {
  return value.startsWith("data:image/") || value.startsWith("/") || /^https?:\/\//i.test(value);
}

function layerToCanvasObjects(
  layer: TemplateLayer,
  design: TemplateDesign,
  content: BoundTemplateContent,
  brandKit: AdStudioBrandKit,
): AdStudioCanvasObject[] {
  const rect = toPixels(layer.rect, design);

  if (layer.type === "shape") {
    return [{
      objectId: layer.id,
      type: "shape",
      role: layer.role ?? "template_shape",
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      fill: layer.fill,
      radius: layer.radius,
      opacity: layer.opacity,
      locked: layer.locked ?? true,
      sourceLayerId: layer.id,
      templateRole: layer.role,
    }];
  }

  if (layer.type === "text") {
    return [{
      objectId: layer.id,
      type: "text",
      role: canvasRoleForTextSlot(layer.slot),
      content: resolveLayerText(layer, content, brandKit),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      font: isHeadingSlot(layer.slot) ? "brand_heading" : "brand_body",
      fontFamily: layer.font,
      size: layer.size,
      lineHeight: layer.lineHeight,
      weight: layer.weight,
      align: layer.align,
      fill: layer.color,
      locked: false,
      sourceLayerId: layer.id,
      templateSlot: layer.slot,
    }];
  }

  if (layer.type === "image_slot") {
    return [{
      objectId: layer.id,
      type: "image",
      role: layer.role === "primary" ? "primary_image" : `${layer.role}_image`,
      content: content.images?.[layer.id] ?? content.images?.[layer.role],
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      imageAnchor: layer.anchor,
      clip: layer.mask === "circle" ? "circle" : layer.mask === "shape" ? "arch" : "rect",
      locked: false,
      sourceLayerId: layer.id,
      templateRole: layer.role,
    }];
  }

  if (layer.type === "logo") {
    return [{
      objectId: layer.id,
      type: "logo",
      role: "brand_logo",
      content: brandKit.identity.tradingName || brandKit.identity.businessName,
      assetId: brandKit.logos.primaryLogoUrl ?? brandKit.logos.darkLogoUrl ?? brandKit.logos.lightLogoUrl ?? undefined,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      locked: false,
      sourceLayerId: layer.id,
    }];
  }

  const shape: AdStudioCanvasObject = {
    objectId: `${layer.id}_shape`,
    type: "shape",
    role: "cta_button",
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    fill: layer.fill,
    radius: layer.radius,
    locked: false,
    sourceLayerId: layer.id,
  };
  const label: AdStudioCanvasObject = {
    objectId: `${layer.id}_label`,
    type: "text",
    role: canvasRoleForTextSlot(layer.label),
    content: resolveTextSlot(layer.label, content, brandKit),
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    font: isHeadingSlot(layer.label) ? "brand_heading" : "brand_body",
    fontFamily: layer.font,
    size: layer.size,
    lineHeight: 1,
    weight: 750,
    align: "center",
    fill: layer.textColor,
    locked: false,
    sourceLayerId: layer.id,
    templateSlot: layer.label,
  };
  return [shape, label];
}

function toPixels(rect: TemplateLayer["rect"], design: TemplateDesign) {
  return {
    x: Math.round(rect.x * design.canvas.w),
    y: Math.round(rect.y * design.canvas.h),
    width: Math.round(rect.w * design.canvas.w),
    height: Math.round(rect.h * design.canvas.h),
  };
}

function resolveLayerText(
  layer: Extract<TemplateLayer, { type: "text" }>,
  content: BoundTemplateContent,
  brandKit: AdStudioBrandKit,
): string {
  const text = layer.fill === "brand"
    ? resolveBrandText(layer.slot, brandKit)
    : layer.fill === "static"
      ? layer.text ?? resolveTextSlot(layer.slot, content, brandKit)
      : resolveTextSlot(layer.slot, content, brandKit) || layer.text || "";
  const cased = layer.case === "upper" ? text.toUpperCase() : text;
  return layer.maxChars ? shortenText(cased, layer.maxChars) : cased;
}

function resolveTextSlot(slot: TextSlot, content: BoundTemplateContent, brandKit: AdStudioBrandKit): string {
  return content.text?.[slot] ?? resolveBrandText(slot, brandKit);
}

function resolveBrandText(slot: TextSlot, brandKit: AdStudioBrandKit): string {
  if (slot === "phone") return brandKit.contact.phone ?? "";
  if (slot === "handle") return brandKit.contact.socialLinks[0] ?? brandKit.identity.tradingName ?? brandKit.identity.businessName;
  return brandKit.identity.tradingName || brandKit.identity.businessName;
}

function isHeadingSlot(slot: TextSlot): boolean {
  return slot === "headline" || slot === "eyebrow" || slot === "stat";
}

function canvasRoleForTextSlot(slot: TextSlot): string {
  if (slot === "subhead") return "subheadline";
  if (slot === "cta") return "cta_text";
  return slot;
}

function shortenText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars - 1).trimEnd();
}

function renderTemplateCreativeSvg(
  creative: Omit<AdStudioCreative, "previewSvg">,
  brandKit?: Pick<AdStudioBrandKit, "identity" | "typography">,
): string {
  const { width, height, objects } = creative.canvas;
  const defs: string[] = [];
  const nodes = objects.map((object) => renderTemplateObjectSvg(object, brandKit, defs)).join("");
  const defsNode = defs.length ? `<defs>${defs.join("")}</defs>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${defsNode}${nodes}</svg>`;
}

function renderTemplateObjectSvg(
  object: AdStudioCanvasObject,
  brandKit?: Pick<AdStudioBrandKit, "identity" | "typography">,
  defs: string[] = [],
): string {
  const height = object.height ?? object.width;
  if (object.type === "text") return renderTextObjectSvg(object, brandKit);

  if (object.type === "logo") {
    const src = object.assetId;
    if (src && isRenderableImageSrc(src)) {
      return `<image x="${object.x}" y="${object.y}" width="${object.width}" height="${height}" href="${escapeXml(src)}" preserveAspectRatio="xMidYMid meet"/>`;
    }
    const label = object.content ?? brandKit?.identity.tradingName ?? brandKit?.identity.businessName ?? "Brand";
    return `<text x="${object.x}" y="${object.y + height * 0.62}" font-family="${escapeXml(svgFontFamily(object, brandKit))}" font-size="${Math.max(18, Math.round(height * 0.42))}" font-weight="850" fill="${escapeXml(object.fill ?? "#111827")}">${escapeXml(label)}</text>`;
  }

  if (object.type === "image") {
    const src = object.content ?? object.assetId;
    if (src && isRenderableImageSrc(src)) {
      const clip = imageClipPath(object, defs);
      return `<image x="${object.x}" y="${object.y}" width="${object.width}" height="${height}" href="${escapeXml(src)}" preserveAspectRatio="${preserveAspectRatioForAnchor(object.imageAnchor)} slice"${clip}/>`;
    }

    return `<rect x="${object.x}" y="${object.y}" width="${object.width}" height="${height}" fill="#D9E7E3"/><path d="M ${object.x} ${object.y + height * 0.72} C ${object.x + object.width * 0.26} ${object.y + height * 0.52}, ${object.x + object.width * 0.5} ${object.y + height * 0.86}, ${object.x + object.width} ${object.y + height * 0.48} L ${object.x + object.width} ${object.y + height} L ${object.x} ${object.y + height} Z" fill="#9EB6AE"/><circle cx="${object.x + object.width * 0.74}" cy="${object.y + height * 0.22}" r="${Math.min(object.width, height) * 0.08}" fill="#F7D98B"/>`;
  }

  const opacity = typeof object.opacity === "number" ? ` opacity="${object.opacity}"` : "";
  return `<rect x="${object.x}" y="${object.y}" width="${object.width}" height="${height}" rx="${object.radius ?? 0}" fill="${escapeXml(object.fill ?? "#F1F5F9")}"${opacity}/>`;
}

function renderTextObjectSvg(
  object: AdStudioCanvasObject,
  brandKit?: Pick<AdStudioBrandKit, "typography">,
): string {
  const size = object.size ?? 48;
  const lineHeight = Math.round(size * (object.lineHeight ?? 1.16));
  const anchor = object.align === "center" ? "middle" : object.align === "right" ? "end" : "start";
  const x = object.align === "center" ? object.x + object.width / 2 : object.align === "right" ? object.x + object.width : object.x;
  const lines = wrapText(object.content ?? "", object.width, size);
  const tspans = lines
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");

  return `<text x="${x}" y="${object.y + size}" font-family="${escapeXml(svgFontFamily(object, brandKit))}" font-size="${size}" font-weight="${object.weight ?? (object.role === "headline" ? 850 : 650)}" fill="${escapeXml(object.fill ?? "#131B2E")}" text-anchor="${anchor}">${tspans}</text>`;
}

function wrapText(value: string, width: number, size: number): string[] {
  const words = value.split(/\s+/u).filter(Boolean);
  const maxChars = Math.max(8, Math.floor(width / Math.max(1, size * 0.52)));
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export function svgToBytes(svg: string): Uint8Array {
  return new TextEncoder().encode(svg);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function preserveAspectRatioForAnchor(anchor: AdStudioCanvasObject["imageAnchor"]): string {
  switch (anchor) {
    case "top":
      return "xMidYMin";
    case "bottom":
      return "xMidYMax";
    case "left":
      return "xMinYMid";
    case "right":
      return "xMaxYMid";
    case "top_left":
      return "xMinYMin";
    case "top_right":
      return "xMaxYMin";
    case "bottom_left":
      return "xMinYMax";
    case "bottom_right":
      return "xMaxYMax";
    default:
      return "xMidYMid";
  }
}
