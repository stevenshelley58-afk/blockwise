import type { AdStudioCreative, AdStudioFormat } from "./types.ts";

const FORMAT_SIZE: Record<AdStudioFormat, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
  "1.91:1": { width: 1200, height: 628 },
};

export function getCanvasSize(format: AdStudioFormat) {
  return FORMAT_SIZE[format];
}

export function renderCreativeSvg(creative: Omit<AdStudioCreative, "previewSvg">): string {
  const { width, height, objects } = creative.canvas;
  const background = objects.find((object) => object.role === "background_shape");
  const fills = {
    bg: background?.fill ?? "#F1F5F9",
    text: "#131B2E",
    accent: "#123E75",
  };
  const nodes = objects
    .filter((object) => object.type !== "safe_zone")
    .map((object) => {
      if (object.type === "text") {
        return `<text x="${object.x}" y="${object.y}" font-family="Inter, Arial, sans-serif" font-size="${object.size ?? 48}" font-weight="${object.role === "headline" ? 850 : 650}" fill="${escapeXml(object.fill ?? fills.text)}">${escapeXml(object.content ?? "")}</text>`;
      }

      if (object.type === "logo") {
        return `<rect x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height ?? object.width * 0.35}" rx="10" fill="${fills.text}"/><text x="${object.x + 20}" y="${object.y + 42}" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="850" fill="#fff">BRAND</text>`;
      }

      if (object.type === "image") {
        const src = object.content ?? object.assetId;
        if (src && isRenderableImageSrc(src)) {
          return `<image x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height ?? object.width}" href="${escapeXml(src)}" preserveAspectRatio="xMidYMid slice"/>`;
        }

        return `<circle cx="${object.x + object.width / 2}" cy="${object.y + (object.height ?? object.width) / 2}" r="${Math.min(object.width, object.height ?? object.width) / 2}" fill="#D9E7E3"/><circle cx="${object.x + object.width / 2}" cy="${object.y + 46}" r="34" fill="#68746F"/><path d="M ${object.x + 38} ${object.y + 142} Q ${object.x + object.width / 2} ${object.y + 72} ${object.x + object.width - 38} ${object.y + 142} Z" fill="#68746F"/>`;
      }

      return `<rect x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height ?? object.width}" rx="18" fill="${escapeXml(object.fill ?? fills.accent)}"/>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${fills.bg}"/><circle cx="${width - 170}" cy="140" r="150" fill="#FFFFFF" opacity="0.55"/><rect x="${Math.round(width * 0.1)}" y="${Math.round(height * 0.58)}" width="${Math.round(width * 0.46)}" height="${Math.round(height * 0.22)}" rx="24" fill="#FFFFFF" opacity="0.88"/><path d="M${Math.round(width * 0.17)} ${Math.round(height * 0.58)} L${Math.round(width * 0.33)} ${Math.round(height * 0.44)} L${Math.round(width * 0.49)} ${Math.round(height * 0.58)} Z" fill="#FFFFFF" opacity="0.88"/>${nodes}</svg>`;
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
