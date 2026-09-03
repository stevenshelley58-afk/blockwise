import type { Rect } from "../../../../packages/ad-template-contract/src/types";
import type { TextLayer } from "../../../../packages/ad-template-contract/src/types";

export interface CanvasDimensions {
  width: number;
  height: number;
}

/**
 * Template packs may express rectangles in either placement pixels or as
 * normalized ratios. The server renderer uses the same rule; keep Fabric's
 * logical scene in those resolved pack coordinates too.
 */
export function resolveGeometry(geometry: Rect, dims: CanvasDimensions): Rect {
  const values = [geometry.x, geometry.y, geometry.width, geometry.height];
  if (values.every((value) => Number.isFinite(value)) && values.every((value) => Math.abs(value) <= 1.001)) {
    return {
      x: geometry.x * dims.width,
      y: geometry.y * dims.height,
      width: geometry.width * dims.width,
      height: geometry.height * dims.height,
    };
  }
  return geometry;
}

/** Fabric's default origin is center; pack rectangles are top-left anchored. */
export function fabricRectGeometry(geometry: Rect) {
  return {
    left: geometry.x,
    top: geometry.y,
    originX: "left" as const,
    originY: "top" as const,
    width: geometry.width,
    height: geometry.height,
  };
}

export function fabricCircleGeometry(geometry: Rect) {
  const diameter = Math.min(geometry.width, geometry.height);
  return {
    left: geometry.x + (geometry.width - diameter) / 2,
    top: geometry.y + (geometry.height - diameter) / 2,
    originX: "left" as const,
    originY: "top" as const,
    radius: diameter / 2,
  };
}

/** Server icon fallbacks use a 0.34×minimum-dimension circle, not a box-filling circle. */
export function fabricIconCircleGeometry(geometry: Rect) {
  const radius = Math.min(geometry.width, geometry.height) * 0.34;
  return {
    left: geometry.x + geometry.width / 2 - radius,
    top: geometry.y + geometry.height / 2 - radius,
    originX: "left" as const,
    originY: "top" as const,
    radius,
  };
}

/**
 * Template packs may include the optional type-treatment metadata produced by
 * Frank's authoring tools. `sizeRatio` is expressed against the resolved
 * layer height, just like the canonical server renderer. Keep this helper
 * independent of Fabric so the editor and its geometry fixtures can assert
 * the same effective authored size without constructing a canvas.
 */
export function effectiveTextFontSize(layer: Pick<TextLayer, "fontSize"> & { sizeRatio?: number }, geometry: Rect): number {
  const ratio = Number(layer.sizeRatio);
  if (Number.isFinite(ratio) && ratio > 0) return geometry.height * ratio;
  return layer.fontSize;
}

/** The canonical renderer draws unknown icons as a stroked circle. */
export type FabricIconShape = "arrow" | "check" | "circle";

export function resolveIconShape(icon: string): FabricIconShape {
  if (icon === "arrow") return "arrow";
  if (icon === "check" || icon === "tick") return "check";
  return "circle";
}

/**
 * Return local path data for the two supported path icons. Circle fallbacks
 * are represented by a Fabric Circle instead, keeping its bounds centred in
 * the authored rectangle.
 */
export function fabricIconPathData(icon: string, width: number, height: number): string | null {
  const shape = resolveIconShape(icon);
  if (shape === "arrow") {
    return `M ${width * .1} ${height / 2} L ${width * .9} ${height / 2} M ${width * .55} ${height * .18} L ${width * .9} ${height / 2} L ${width * .55} ${height * .82}`;
  }
  if (shape === "check") {
    return `M ${width * .18} ${height / 2} L ${width * .42} ${height * .76} L ${width * .84} ${height * .24}`;
  }
  return null;
}

/** Rounded image masks use the same fixed corner radius as the server. */
export function imageMaskRadius(): number {
  return 16;
}

/**
 * Path and polygon data are local to a Fabric object, not canvas coordinates.
 * Fabric normalizes path data around pathOffset, so include the local command
 * bounds when translating the object back into pack canvas coordinates.
 */
export function fabricPathPosition(path: { width: number; height: number; pathOffset?: { x: number; y: number } }, geometry: Rect) {
  const pathOffset = path.pathOffset ?? { x: path.width / 2, y: path.height / 2 };
  return {
    left: geometry.x + pathOffset.x - path.width / 2,
    top: geometry.y + pathOffset.y - path.height / 2,
    originX: "left" as const,
    originY: "top" as const,
  };
}
