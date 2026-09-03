import type { Rect } from "../../../../packages/ad-template-contract/src/types";

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

