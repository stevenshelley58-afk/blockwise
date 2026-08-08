import type { NormBox } from "@/lib/adstudio/v2/template-doc";

/** Convert Konva's layout-pixel drag position to the one editor NormBox contract. */
export function layoutPixelsToNormBox(
  layout: { width: number; height: number },
  box: { x: number; y: number; width: number; height: number },
): NormBox {
  return {
    x: box.x / layout.width,
    y: box.y / layout.height,
    width: box.width / layout.width,
    height: box.height / layout.height,
  };
}

/** Clamp normalized drag output once, at the boundary that persists it. */
export function clampEditorNormBox(box: NormBox): NormBox {
  const width = Math.min(1, Math.max(0.05, box.width));
  const height = Math.min(1, Math.max(0.05, box.height));
  return {
    x: Math.min(1 - width, Math.max(0, box.x)),
    y: Math.min(1 - height, Math.max(0, box.y)),
    width,
    height,
  };
}
