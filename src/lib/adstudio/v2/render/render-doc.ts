// The one deterministic draw sequence.
//
// renderAdDoc(ctx, doc, instance, assets, format) draws: plate → layers in
// ascending z (image slots with focal+zoom cover-crop and mask clip, overlay
// patches, text layers). Identical code runs on the browser canvas (editor
// preview) and @napi-rs/canvas (server, canonical pixels); the parity test
// pins the two backends together.
//
// Text typesetting ports the proven v1 logic from
// src/components/adstudio/canvas/text-patch.ts: measured-line mapping first,
// block-wrap fallback second, shrink-to-fit down to constraints.autoFitMinRatio,
// and REFUSAL (RenderFitError) below the floor. We never ship microtype.

import type {
  AdDocInstance,
  AdTemplateDocV2,
  NormBox,
  TemplateLayer,
  TemplateLayout,
  TextLayer,
} from "../template-doc.ts";
import { DEFAULT_AUTO_FIT_MIN_RATIO, TEMPLATE_FORMAT_DIMENSIONS } from "../template-doc.ts";
import { focalCoverSourceRect } from "./cover-crop.ts";
import type { Canvas2DLike, CanvasImageLike, RenderedAssets } from "./types.ts";

/** Which authored layout to draw — the doc carries one per key. */
export type AdDocLayoutKey = "feed" | "story";

export type AdDocFormat = keyof typeof TEMPLATE_FORMAT_DIMENSIONS;

/** The renderer refused to typeset a layer rather than produce microtype. */
export class RenderFitError extends Error {
  readonly layerId: string;
  readonly inputKey: string;

  constructor(layerId: string, inputKey: string, message: string) {
    super(message);
    this.name = "RenderFitError";
    this.layerId = layerId;
    this.inputKey = inputKey;
  }
}

type TextOverrides = {
  box?: NormBox;
  sizeRatio?: number;
  align?: "left" | "center" | "right";
  color?: string;
};

function collectOverrides(instance: AdDocInstance | null): Map<string, TextOverrides> {
  const map = new Map<string, TextOverrides>();
  if (!instance) return map;
  for (const override of instance.overrides) {
    const entry = map.get(override.layerId) ?? {};
    if (override.op === "move") entry.box = override.box;
    if (override.op === "font-size") entry.sizeRatio = override.sizeRatio;
    if (override.op === "align") entry.align = override.align;
    if (override.op === "color") entry.color = override.color;
    map.set(override.layerId, entry);
  }
  return map;
}

function applyCase(text: string, mode: TextLayer["typo"]["case"]): string {
  if (mode === "upper") return text.toUpperCase();
  if (mode === "lower") return text.toLowerCase();
  return text;
}

function fontString(layer: TextLayer, sizePx: number): string {
  const { typo } = layer;
  return `${typo.italic ? "italic " : ""}${typo.weight} ${sizePx}px "${typo.fontId}", ${typo.fallbackFamily}`;
}

/**
 * Tracking is em-based in the doc. We emulate it manually (per-glyph advance)
 * instead of relying on ctx.letterSpacing so both backends behave identically —
 * napi-rs/canvas and Chrome disagree on letterSpacing support/metrics.
 */
function trackingPx(layer: TextLayer, fontSize: number): number {
  return layer.typo.tracking * fontSize;
}

function measuredWidth(ctx: Canvas2DLike, text: string, tracking: number): number {
  if (text.length === 0) return 0;
  return ctx.measureText(text).width + tracking * (text.length - 1);
}

function drawTrackedText(
  ctx: Canvas2DLike,
  text: string,
  x: number,
  y: number,
  tracking: number,
  align: "left" | "center" | "right",
  mode: "fill" | "stroke",
): void {
  if (text.length === 0) return;
  if (tracking === 0) {
    if (mode === "fill") ctx.fillText(text, x, y);
    else ctx.strokeText(text, x, y);
    return;
  }
  // Manual per-glyph advance. x is the align anchor; recompute the line's
  // total width so left/center/right anchoring matches native behaviour.
  const total = measuredWidth(ctx, text, tracking);
  let cursor = align === "left" ? x : align === "right" ? x - total : x - total / 2;
  const draw = mode === "fill" ? ctx.fillText.bind(ctx) : ctx.strokeText.bind(ctx);
  const previousAlign = ctx.textAlign;
  ctx.textAlign = "left";
  for (const char of text) {
    draw(char, cursor, y);
    cursor += ctx.measureText(char).width + tracking;
  }
  ctx.textAlign = previousAlign;
}

/** Deterministic word partition; preserves the sample's measured line balance. */
export function splitTextIntoMeasuredLines(
  text: string,
  measured: number | Array<{ text: string }>,
): string[] {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  const templates = typeof measured === "number"
    ? Array.from({ length: measured }, () => ({ text: "" }))
    : measured;
  const count = Math.max(1, Math.min(templates.length, words.length || 1));
  if (count === 1) return [words.join(" ")];
  const weights = templates.slice(0, count).map((line) => (
    Math.max(1, line.text.trim().split(/\s+/u).filter(Boolean).length)
  ));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const lines: string[] = [];
  let cursor = 0;
  let cumulativeWeight = 0;
  for (let line = 0; line < count; line += 1) {
    cumulativeWeight += weights[line]!;
    const remainingLines = count - line - 1;
    const desiredEnd = line === count - 1
      ? words.length
      : Math.round((words.length * cumulativeWeight) / totalWeight);
    const take = Math.max(1, Math.min(
      desiredEnd - cursor,
      words.length - cursor - remainingLines,
    ));
    lines.push(words.slice(cursor, cursor + take).join(" "));
    cursor += take;
  }
  return lines;
}

function wrapToWidth(ctx: Canvas2DLike, text: string, maxWidth: number, tracking: number): string[] {
  const words = text.split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measuredWidth(ctx, candidate, tracking) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function inkHeight(ctx: Canvas2DLike, text: string, fontSize: number): number {
  const metrics = ctx.measureText(text);
  const ascent = metrics.actualBoundingBoxAscent;
  const descent = metrics.actualBoundingBoxDescent;
  if (typeof ascent === "number" && typeof descent === "number") {
    const ink = ascent + descent;
    if (Number.isFinite(ink) && ink > 0) return ink;
  }
  return fontSize;
}

/**
 * textBaseline "middle" centres the EM box, whose ink sits asymmetrically and
 * differently on each font engine (freetype vs Chrome). Offsetting by half the
 * ink's own asymmetry centres the INK instead, so both backends place glyphs
 * on the same pixels — the parity gate compares rendered ink, not em theory.
 */
function inkCenterOffset(ctx: Canvas2DLike, text: string): number {
  const metrics = ctx.measureText(text);
  const ascent = metrics.actualBoundingBoxAscent;
  const descent = metrics.actualBoundingBoxDescent;
  if (typeof ascent === "number" && typeof descent === "number" && Number.isFinite(ascent) && Number.isFinite(descent)) {
    return (descent - ascent) / 2;
  }
  return 0;
}

function boxPx(box: NormBox, layout: TemplateLayout): { left: number; top: number; width: number; height: number } {
  // Snap to whole device pixels. Fractional drawImage destinations resample
  // differently on each backend — snapping makes the slot/patch output
  // byte-comparable in the parity gate and crisper on screen. Deterministic:
  // same doc always rounds the same way.
  const left = Math.round(box.x * layout.width);
  const top = Math.round(box.y * layout.height);
  const right = Math.round((box.x + box.width) * layout.width);
  const bottom = Math.round((box.y + box.height) * layout.height);
  return { left, top, width: right - left, height: bottom - top };
}

function applyGradient(
  ctx: Canvas2DLike,
  layer: TextLayer,
  rect: { left: number; top: number; width: number; height: number },
  color: string,
): void {
  const gradient = layer.typo.effects?.gradientFill;
  if (!gradient) {
    ctx.fillStyle = color;
    return;
  }
  // Angle 0 = left→right, 90 = top→bottom (CSS-ish). The gradient spans the
  // text box diagonal projected onto the angle direction.
  const radians = (gradient.angleDeg * Math.PI) / 180;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const half = (Math.abs(dx) * rect.width + Math.abs(dy) * rect.height) / 2;
  const linear = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  linear.addColorStop(0, gradient.from);
  linear.addColorStop(1, gradient.to);
  ctx.fillStyle = linear;
}

function drawTextLayer(
  ctx: Canvas2DLike,
  doc: AdTemplateDocV2,
  layer: TextLayer,
  layout: TemplateLayout,
  instance: AdDocInstance | null,
  overrides: Map<string, TextOverrides>,
): void {
  const override = overrides.get(layer.id) ?? {};
  const box = override.box ?? layer.box;
  const rect = boxPx(box, layout);
  const align = override.align ?? layer.typo.align;
  const color = override.color ?? layer.typo.color;

  const input = doc.inputs.text.find((candidate) => candidate.key === layer.inputKey);
  const rawValue = instance?.values.text[layer.inputKey] ?? input?.sample ?? "";
  const value = applyCase(rawValue, layer.typo.case);
  if (value.length === 0) return;

  const baseSizeRatio = override.sizeRatio ?? layer.typo.sizeRatio;
  const floor = layer.constraints.autoFitMinRatio || DEFAULT_AUTO_FIT_MIN_RATIO;
  const tracking = trackingPx(layer, rect.height * baseSizeRatio);

  // With rotation, draw inside a transformed frame centred on the box.
  const rotation = layer.rotation ?? 0;
  ctx.save();
  if (rotation !== 0) {
    ctx.translate(rect.left + rect.width / 2, rect.top + rect.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-(rect.left + rect.width / 2), -(rect.top + rect.height / 2));
  }

  const anchorX = align === "left"
    ? rect.left + rect.width * 0.01
    : align === "right"
      ? rect.left + rect.width * 0.99
      : rect.left + rect.width / 2;

  ctx.textBaseline = "middle";
  ctx.textAlign = align;

  const measuredLines = layer.typo.measuredLines;
  if (measuredLines && measuredLines.length > 0) {
    // Per-line measured path: each line keeps its own box/size/scale from the
    // source measurement. Copy is redistributed across the same line count.
    const values = splitTextIntoMeasuredLines(value, measuredLines);
    for (let index = 0; index < measuredLines.length; index += 1) {
      const measured = measuredLines[index]!;
      const lineValue = values[index] ?? "";
      if (!lineValue) continue;
      const lineRect = boxPx(measured.box, layout);
      const scale = measured.scaleX ?? 1;
      let fontSize = Math.max(1, lineRect.height * measured.sizeRatio);
      const minimum = fontSize * floor;
      const lineTracking = layer.typo.tracking * fontSize;
      ctx.font = fontString(layer, fontSize);
      for (; fontSize >= minimum; fontSize -= 0.5) {
        ctx.font = fontString(layer, fontSize);
        if (measuredWidth(ctx, lineValue, layer.typo.tracking * fontSize) <= lineRect.width * 0.98) break;
      }
      if (fontSize < minimum) {
        ctx.restore();
        throw new RenderFitError(
          layer.id,
          layer.inputKey,
          `text layer ${layer.id} cannot fit "${lineValue}" above the ${floor} autofit floor`,
        );
      }
      const x = align === "left"
        ? lineRect.left + lineRect.width * 0.01
        : align === "right"
          ? lineRect.left + lineRect.width * 0.99
          : lineRect.left + lineRect.width / 2;
      ctx.save();
      ctx.translate(x, lineRect.top + lineRect.height / 2 - inkCenterOffset(ctx, lineValue));
      ctx.scale(scale, 1);
      applyEffectsAndDraw(ctx, layer, lineValue, 0, 0, fontSize, lineTracking, align, color, {
        left: lineRect.left,
        top: lineRect.top,
        width: lineRect.width,
        height: lineRect.height,
      });
      ctx.restore();
    }
    ctx.restore();
    return;
  }

  // Block-wrap fallback: shrink-to-fit from the measured size ratio down to
  // the floor, gating on the widest line, line count, and painted ink height.
  const maxTextWidth = rect.width * 0.98;
  let fontSize = Math.max(1, rect.height * baseSizeRatio);
  const minimumSize = fontSize * floor;
  let lines: string[] = [];
  for (; fontSize >= minimumSize; fontSize -= 0.5) {
    ctx.font = fontString(layer, fontSize);
    const candidate = wrapToWidth(ctx, value, maxTextWidth, layer.typo.tracking * fontSize);
    if (candidate.length === 0) break;
    if (candidate.length > layer.constraints.maxLines) continue;
    const widest = Math.max(...candidate.map((line) => measuredWidth(ctx, line, layer.typo.tracking * fontSize)));
    const tallestInk = Math.max(...candidate.map((line) => inkHeight(ctx, line, fontSize)));
    const paintedHeight = tallestInk + (candidate.length - 1) * fontSize * layer.typo.lineHeight;
    if (widest <= maxTextWidth && paintedHeight <= rect.height * 1.02) {
      lines = candidate;
      break;
    }
  }
  if (lines.length === 0) {
    ctx.restore();
    throw new RenderFitError(
      layer.id,
      layer.inputKey,
      `text layer ${layer.id} cannot fit its copy above the ${floor} autofit floor`,
    );
  }

  const lineHeight = fontSize * layer.typo.lineHeight;
  const firstCenter = rect.top + rect.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  const lineTracking = layer.typo.tracking * fontSize;
  ctx.font = fontString(layer, fontSize);
  const inkOffset = inkCenterOffset(ctx, lines[0] ?? "");
  lines.forEach((line, index) => {
    applyEffectsAndDraw(ctx, layer, line, anchorX, firstCenter + index * lineHeight - inkOffset, fontSize, lineTracking, align, color, rect);
  });
  ctx.restore();
}

/** Stroke (behind), then fill with shadow + colour/gradient. */
function applyEffectsAndDraw(
  ctx: Canvas2DLike,
  layer: TextLayer,
  line: string,
  x: number,
  y: number,
  fontSize: number,
  tracking: number,
  align: "left" | "center" | "right",
  color: string,
  rect: { left: number; top: number; width: number; height: number },
): void {
  const effects = layer.typo.effects;

  if (effects?.stroke) {
    ctx.save();
    ctx.strokeStyle = effects.stroke.color;
    ctx.lineWidth = Math.max(0.5, rect.height * effects.stroke.widthRatio);
    drawTrackedText(ctx, line, x, y, tracking, align, "stroke");
    ctx.restore();
  }

  ctx.save();
  if (effects?.shadow) {
    ctx.shadowColor = effects.shadow.color;
    ctx.shadowBlur = rect.height * effects.shadow.blurRatio;
    ctx.shadowOffsetX = effects.shadow.dx * rect.width;
    ctx.shadowOffsetY = effects.shadow.dy * rect.height;
  }
  const previousFill = ctx.fillStyle;
  applyGradient(ctx, layer, rect, color);
  drawTrackedText(ctx, line, x, y, tracking, align, "fill");
  ctx.fillStyle = previousFill;
  ctx.restore();
}

function clipMaskPath(
  ctx: Canvas2DLike,
  rect: { left: number; top: number; width: number; height: number },
  mask: { kind: "rect" | "rounded" | "ellipse"; radius?: number },
): void {
  ctx.beginPath();
  if (mask.kind === "ellipse") {
    ctx.ellipse(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      rect.width / 2,
      rect.height / 2,
      0,
      0,
      Math.PI * 2,
    );
  } else if (mask.kind === "rounded") {
    // Radius is specified at 1080w; every layout is 1080 wide, but clamp
    // defensively so a too-large radius can never invert the path.
    const radius = Math.min(mask.radius ?? 0, rect.width / 2, rect.height / 2);
    roundedRectPath(ctx, rect.left, rect.top, rect.width, rect.height, radius);
  } else {
    ctx.rect(rect.left, rect.top, rect.width, rect.height);
  }
  ctx.clip();
}

function roundedRectPath(
  ctx: Canvas2DLike,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.moveTo(x + r, y);
  ctx.arc(x + width - r, y + r, r, -Math.PI / 2, 0);
  ctx.arc(x + width - r, y + height - r, r, 0, Math.PI / 2);
  ctx.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI);
  ctx.arc(x + r, y + r, r, Math.PI, (3 * Math.PI) / 2);
  ctx.closePath();
}

function drawImageSlot(
  ctx: Canvas2DLike,
  layer: Extract<TemplateLayer, { type: "image_slot" }>,
  layout: TemplateLayout,
  instance: AdDocInstance | null,
  assets: RenderedAssets,
): void {
  const image = assets.slotImages.get(layer.inputKey);
  if (!image) return; // guided render always supplies every slot; absence = plate shows through
  const rect = boxPx(layer.box, layout);
  const values = instance?.values.images[layer.inputKey];
  const placement = focalCoverSourceRect({
    slotWidthPx: rect.width,
    slotHeightPx: rect.height,
    imageWidth: image.width,
    imageHeight: image.height,
    focal: values?.focal ?? layer.focal,
    zoom: values?.zoom ?? 1,
  });

  ctx.save();
  const rotation = layer.rotation ?? 0;
  if (rotation !== 0) {
    ctx.translate(rect.left + rect.width / 2, rect.top + rect.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-(rect.left + rect.width / 2), -(rect.top + rect.height / 2));
  }
  clipMaskPath(ctx, rect, layer.mask);
  ctx.drawImage(
    image as CanvasImageLike,
    placement.sx,
    placement.sy,
    placement.sw,
    placement.sh,
    rect.left,
    rect.top,
    rect.width,
    rect.height,
  );
  ctx.restore();
}

function drawOverlayPatch(
  ctx: Canvas2DLike,
  layer: Extract<TemplateLayer, { type: "overlay_patch" }>,
  layout: TemplateLayout,
  assets: RenderedAssets,
): void {
  const patch = assets.patches.get(layer.id);
  if (!patch) return;
  const rect = boxPx(layer.box, layout);
  ctx.save();
  const rotation = layer.rotation ?? 0;
  if (rotation !== 0) {
    ctx.translate(rect.left + rect.width / 2, rect.top + rect.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-(rect.left + rect.width / 2), -(rect.top + rect.height / 2));
  }
  ctx.drawImage(patch as CanvasImageLike, rect.left, rect.top, rect.width, rect.height);
  ctx.restore();
}

/**
 * Draw one layout of a template (+ optional customer instance) onto ctx.
 * Pure and side-effect-free beyond canvas commands: same inputs, same pixels.
 */
export function renderAdDoc(
  ctx: Canvas2DLike,
  doc: AdTemplateDocV2,
  instance: AdDocInstance | null,
  assets: RenderedAssets,
  layoutKey: AdDocLayoutKey,
): void {
  const layout = doc.formats[layoutKey];
  if (!layout) {
    throw new Error(`template ${doc.id} has no ${layoutKey} layout`);
  }
  if (instance && instance.format !== layout.format) {
    throw new Error(
      `instance format ${instance.format} does not match the ${layoutKey} layout (${layout.format})`,
    );
  }

  // 1. Plate: the designer's original pixels, full-bleed.
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.drawImage(assets.plate as CanvasImageLike, 0, 0, layout.width, layout.height);
  ctx.restore();

  // 2. Layers above the plate, ascending z.
  const ordered = [...layout.layers].sort((a, b) => a.z - b.z);
  const overrides = collectOverrides(instance);
  for (const layer of ordered) {
    if (layer.type === "image_slot") {
      drawImageSlot(ctx, layer, layout, instance, assets);
    } else if (layer.type === "overlay_patch") {
      drawOverlayPatch(ctx, layer, layout, assets);
    } else {
      drawTextLayer(ctx, doc, layer, layout, instance, overrides);
    }
  }
}
