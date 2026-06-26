import type { AdStudioBrandKit, AdStudioCanvasObject, AdStudioCreative } from "./types.ts";

type BrandSvgContext = Pick<AdStudioBrandKit, "identity" | "typography">;

export function renderCreativeSvg(
  creative: Omit<AdStudioCreative, "previewSvg">,
  brandKit?: BrandSvgContext,
): string {
  const { width, height, objects } = creative.canvas;
  const defs: string[] = [];
  const nodes = objects
    .filter((object) => object.type !== "safe_zone")
    .map((object) => renderObjectSvg(object, brandKit, defs))
    .join("");
  const defsNode = defs.length ? `<defs>${defs.join("")}</defs>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${defsNode}${nodes}</svg>`;
}

export function svgToBytes(svg: string): Uint8Array {
  return new TextEncoder().encode(svg);
}

function renderObjectSvg(
  object: AdStudioCanvasObject,
  brandKit?: BrandSvgContext,
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
