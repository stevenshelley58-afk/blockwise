// Client-side deterministic text patch rendering.
//
// The browser is the only place in the stack with real fonts (serverless sharp
// has no fontconfig), so it renders the customer's exact copy over the clean
// plate crop and sends the finished patch to the server, which clamps it to
// the selected region and composites. The same patch doubles as the optimistic
// overlay: what the customer sees instantly IS the final pixels.

import type { AdStudioTextLayerStyle } from "@/lib/adstudio/types.ts";

type NormalizedBox = { x: number; y: number; width: number; height: number };

/** Mirrors COMPOSITE_PADDING in region-edit.ts so patch pixels line up exactly. */
export const PATCH_PADDING = 0.02;

/** Pixel rect math identical to the server's paddedPixelRect. */
export function paddedPatchRect(box: NormalizedBox, imageWidth: number, imageHeight: number) {
  const left = Math.max(0, Math.floor((box.x - PATCH_PADDING) * imageWidth));
  const top = Math.max(0, Math.floor((box.y - PATCH_PADDING) * imageHeight));
  const right = Math.min(imageWidth, Math.ceil((box.x + box.width + PATCH_PADDING) * imageWidth));
  const bottom = Math.min(imageHeight, Math.ceil((box.y + box.height + PATCH_PADDING) * imageHeight));
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

const FONT_STACKS: Record<AdStudioTextLayerStyle["family"], string> = {
  sans: "Arial, 'Helvetica Neue', Helvetica, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  slab: "Rockwell, 'Roboto Slab', Georgia, serif",
  condensed: "'Arial Narrow', 'Helvetica Neue', Arial, sans-serif",
  rounded: "'Arial Rounded MT Bold', 'Segoe UI', Arial, sans-serif",
  script: "'Segoe Script', 'Brush Script MT', cursive",
  mono: "'Courier New', Courier, monospace",
};

export const DEFAULT_TEXT_LAYER_STYLE: AdStudioTextLayerStyle = {
  family: "sans",
  weight: 700,
  italic: false,
  uppercase: false,
  color: "#ffffff",
  align: "center",
  letterSpacing: "normal",
};

export function loadPatchImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The editing plate could not be loaded."));
    image.src = src;
  });
}

function fontString(style: AdStudioTextLayerStyle, sizePx: number): string {
  return `${style.italic ? "italic " : ""}${style.weight} ${sizePx}px ${FONT_STACKS[style.family]}`;
}

function wrapToWidth(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Render the replacement copy over the plate crop for one text region.
 * Returns a PNG data URL sized exactly to the region's padded pixel rect,
 * or null when the browser cannot produce a canvas (the caller falls back to
 * the model path).
 */
export function renderTextPatch(input: {
  plate: HTMLImageElement;
  box: NormalizedBox;
  style: AdStudioTextLayerStyle;
  text: string;
}): string | null {
  const imageWidth = input.plate.naturalWidth;
  const imageHeight = input.plate.naturalHeight;
  if (!imageWidth || !imageHeight) return null;

  const rect = paddedPatchRect(input.box, imageWidth, imageHeight);
  const canvas = document.createElement("canvas");
  canvas.width = rect.width;
  canvas.height = rect.height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.drawImage(
    input.plate,
    rect.left, rect.top, rect.width, rect.height,
    0, 0, rect.width, rect.height,
  );

  const value = input.style.uppercase ? input.text.toUpperCase() : input.text;
  // The writable area is the un-padded region box, in patch-local pixels.
  const inner = {
    left: Math.round(input.box.x * imageWidth) - rect.left,
    top: Math.round(input.box.y * imageHeight) - rect.top,
    width: Math.max(1, Math.round(input.box.width * imageWidth)),
    height: Math.max(1, Math.round(input.box.height * imageHeight)),
  };
  const maxTextWidth = inner.width * 0.98;
  if ("letterSpacing" in context) {
    context.letterSpacing = input.style.letterSpacing === "wide" ? "0.08em" : "0px";
  }

  // Fit: largest size where the wrapped copy fits the region both ways.
  const lineHeightFactor = 1.16;
  let fontSize = Math.min(220, Math.max(10, Math.floor(inner.height * 0.82)));
  let lines: string[] = [];
  for (; fontSize >= 10; fontSize -= 1) {
    context.font = fontString(input.style, fontSize);
    const candidate = wrapToWidth(context, value, maxTextWidth);
    if (candidate.length === 0) return null;
    const widest = Math.max(...candidate.map((line) => context.measureText(line).width));
    if (widest <= maxTextWidth && candidate.length * fontSize * lineHeightFactor <= inner.height * 1.04) {
      lines = candidate;
      break;
    }
  }
  if (lines.length === 0) {
    context.font = fontString(input.style, 10);
    lines = wrapToWidth(context, value, maxTextWidth);
  }

  context.fillStyle = input.style.color;
  context.textBaseline = "middle";
  context.textAlign = input.style.align;
  const anchorX = input.style.align === "left"
    ? inner.left + inner.width * 0.01
    : input.style.align === "right"
      ? inner.left + inner.width * 0.99
      : inner.left + inner.width / 2;
  const lineHeight = fontSize * lineHeightFactor;
  const firstCenter = inner.top + inner.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    context.fillText(line, anchorX, firstCenter + index * lineHeight);
  });

  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
