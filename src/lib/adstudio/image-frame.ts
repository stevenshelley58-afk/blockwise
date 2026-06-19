// Pure helpers that turn a template's normalized image_frame into a pixel rect
// for a given canvas size. No DOM/network — unit-testable. Used by the
// composition->creative builder to place the listing photo into the template's
// spot; when no frame is supplied the builder keeps its existing placement.

import type { CreativeImageFrame } from "../ad-template-library/skeleton.ts";
import type { AdStudioFormat } from "./types.ts";

export type FrameRect = { x: number; y: number; width: number; height: number };

/** The primary listing photo is the first frame; null when none are defined. */
export function pickPrimaryImageFrame(frames: CreativeImageFrame[] | undefined): CreativeImageFrame | null {
  return frames && frames.length > 0 ? frames[0] : null;
}

/**
 * Resolves a frame to a pixel rect for `format` at `canvasWidth`×`canvasHeight`.
 * A per-size override for the format wins; otherwise the frame's base rect is used.
 */
export function resolveImageFrameRect(input: {
  frame: CreativeImageFrame;
  format: AdStudioFormat;
  canvasWidth: number;
  canvasHeight: number;
}): FrameRect {
  const override = input.frame.per_size?.[input.format];
  const base = override ?? {
    x: input.frame.x,
    y: input.frame.y,
    width: input.frame.width,
    height: input.frame.height,
  };

  return {
    x: Math.round(base.x * input.canvasWidth),
    y: Math.round(base.y * input.canvasHeight),
    width: Math.round(base.width * input.canvasWidth),
    height: Math.round(base.height * input.canvasHeight),
  };
}
