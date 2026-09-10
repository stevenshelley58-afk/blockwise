import type { Rect, SupportedIconName, TextLayer } from "../../../../packages/ad-template-contract/src/types";

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

/** Convert absolute placement-canvas tracking pixels to Fabric's thousandths-of-em unit. */
export function fabricCharSpacing(trackingPixels: number, fontSizePixels: number): number {
  return Number.isFinite(fontSizePixels) && fontSizePixels > 0
    ? trackingPixels * 1000 / fontSizePixels
    : 0;
}

/** Every accepted icon name maps to a painted semantic path. */
export type FabricIconShape = SupportedIconName;

export function resolveIconShape(icon: string): FabricIconShape | null {
  if (icon === "arrow") return "arrow";
  if (icon === "check" || icon === "tick") return "check";
  if (icon === "phone" || icon === "mail" || icon === "globe" || icon === "location") return icon;
  return null;
}

/**
 * Return local path data for every icon accepted by the shared contract.
 */
export function fabricIconPathData(icon: string, width: number, height: number): string | null {
  const shape = resolveIconShape(icon);
  if (shape === "arrow") {
    return `M ${width * .1} ${height / 2} L ${width * .9} ${height / 2} M ${width * .55} ${height * .18} L ${width * .9} ${height / 2} L ${width * .55} ${height * .82}`;
  }
  if (shape === "check") {
    return `M ${width * .18} ${height / 2} L ${width * .42} ${height * .76} L ${width * .84} ${height * .24}`;
  }
  if (shape === "phone") {
    return `M ${width * .22} ${height * .16} C ${width * .12} ${height * .24} ${width * .2} ${height * .52} ${width * .43} ${height * .73} C ${width * .64} ${height * .92} ${width * .82} ${height * .89} ${width * .88} ${height * .76} L ${width * .68} ${height * .6} L ${width * .54} ${height * .7} C ${width * .43} ${height * .64} ${width * .34} ${height * .54} ${width * .29} ${height * .42} L ${width * .39} ${height * .3} Z`;
  }
  if (shape === "mail") {
    return `M ${width * .1} ${height * .22} L ${width * .9} ${height * .22} L ${width * .9} ${height * .8} L ${width * .1} ${height * .8} Z M ${width * .1} ${height * .24} L ${width * .5} ${height * .56} L ${width * .9} ${height * .24}`;
  }
  if (shape === "globe") {
    const cx = width / 2, cy = height / 2, radius = Math.min(width, height) * .36;
    return `M ${cx + radius} ${cy} A ${radius} ${radius} 0 1 0 ${cx - radius} ${cy} A ${radius} ${radius} 0 1 0 ${cx + radius} ${cy} M ${cx} ${cy - radius} C ${cx - radius * .45} ${cy - radius * .55} ${cx - radius * .45} ${cy + radius * .55} ${cx} ${cy + radius} M ${cx} ${cy - radius} C ${cx + radius * .45} ${cy - radius * .55} ${cx + radius * .45} ${cy + radius * .55} ${cx} ${cy + radius} M ${cx - radius} ${cy} L ${cx + radius} ${cy}`;
  }
  if (shape === "location") {
    return `M ${width * .5} ${height * .9} C ${width * .28} ${height * .68} ${width * .2} ${height * .5} ${width * .2} ${height * .36} C ${width * .2} ${height * .14} ${width * .34} ${height * .08} ${width * .5} ${height * .08} C ${width * .66} ${height * .08} ${width * .8} ${height * .14} ${width * .8} ${height * .36} C ${width * .8} ${height * .5} ${width * .72} ${height * .68} ${width * .5} ${height * .9} Z M ${width * .59} ${height * .35} A ${width * .09} ${width * .09} 0 1 0 ${width * .41} ${height * .35} A ${width * .09} ${width * .09} 0 1 0 ${width * .59} ${height * .35}`;
  }
  return null;
}

export function fabricLinePathData(width: number, height: number): string {
  return height > width
    ? `M ${width / 2} 0 L ${width / 2} ${height}`
    : `M 0 ${height / 2} L ${width} ${height / 2}`;
}

/** Rounded image masks use the canonical 16px radius, clamped to the box. */
export function imageMaskRadius(geometry: Pick<Rect, "width" | "height">): number {
  return Math.min(16, geometry.width / 2, geometry.height / 2);
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
