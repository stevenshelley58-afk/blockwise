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
          return `<image x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height ?? object.width}" href="${escapeXml(src)}" preserveAspectRatio="xMidYMid slice"${clip}/>`;
        }

        return `<circle cx="${object.x + object.width / 2}" cy="${object.y + (object.height ?? object.width) / 2}" r="${Math.min(object.width, object.height ?? object.width) / 2}" fill="#D9E7E3"/><circle cx="${object.x + object.width / 2}" cy="${object.y + 46}" r="34" fill="#68746F"/><path d="M ${object.x + 38} ${object.y + 142} Q ${object.x + object.width / 2} ${object.y + 72} ${object.x + object.width - 38} ${object.y + 142} Z" fill="#68746F"/>`;
      }

      return `<rect x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height ?? object.width}" rx="18" fill="${escapeXml(object.fill ?? fills.accent)}"/>`;
    })
    .join("");

  const defsNode = defs.length ? `<defs>${defs.join("")}</defs>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${defsNode}<rect width="100%" height="100%" fill="${fills.bg}"/><circle cx="${width - 170}" cy="140" r="150" fill="#FFFFFF" opacity="0.55"/><rect x="${Math.round(width * 0.1)}" y="${Math.round(height * 0.58)}" width="${Math.round(width * 0.46)}" height="${Math.round(height * 0.22)}" rx="24" fill="#FFFFFF" opacity="0.88"/><path d="M${Math.round(width * 0.17)} ${Math.round(height * 0.58)} L${Math.round(width * 0.33)} ${Math.round(height * 0.44)} L${Math.round(width * 0.49)} ${Math.round(height * 0.58)} Z" fill="#FFFFFF" opacity="0.88"/>${nodes}</svg>`;
}

// Clip-path for image cut-outs (agent_headshot circle / arch). Empty for rect.
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

export function svgToBytes(svg: string): Uint8Array {
  return new TextEncoder().encode(svg);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
