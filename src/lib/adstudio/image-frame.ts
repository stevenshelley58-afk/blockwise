// Pure helpers that turn a template's normalized image_frame into a pixel rect
// for a given canvas size. No DOM/network — unit-testable. Used by the
// composition->creative builder to place the listing photo into the template's
// spot; when no frame is supplied the builder keeps its existing placement.

import type { CompositionImageFrame, CreativeImageFrame } from "../ad-template-library/skeleton.ts";
import type { AdStudioCanvasObject, AdStudioFormat } from "./types.ts";

export type FrameRect = { x: number; y: number; width: number; height: number };

const ROLE_RANK: Record<NonNullable<CompositionImageFrame["role"]>, number> = {
  primary: 0,
  secondary: 1,
  agent_headshot: 2,
};

/**
 * Turn a template's role-tagged composition.image_frames into placed canvas
 * image objects for one format. Pure (no DOM/network), so the compositor and
 * tests share one placement contract.
 *
 * Source assignment is deterministic: the primary slot uses the user's uploaded
 * photo (or the first listing image), secondary slots fill from the remaining
 * listing images, and agent_headshot slots use the first brand headshot and are
 * clipped to a circle (cut-out). Returns [] when no frame matches the format, so
 * the caller keeps its full-bleed fallback. The primary slot keeps the
 * objectId/role "primary_image" for backward compatibility.
 */
export function buildTemplateImageObjects(input: {
  frames: CompositionImageFrame[] | undefined;
  format: AdStudioFormat;
  canvasWidth: number;
  canvasHeight: number;
  primarySrc?: string;
  listingImages?: string[];
  headshots?: string[];
}): AdStudioCanvasObject[] {
  const frames = (input.frames ?? []).filter((frame) => !frame.formats || frame.formats.includes(input.format));
  if (frames.length === 0) return [];

  const ordered = [...frames].sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role]);
  const listing = (input.listingImages ?? []).filter(Boolean);
  const headshots = (input.headshots ?? []).filter(Boolean);
  let listingCursor = 0;
  let secondaryCount = 0;

  return ordered.map((frame) => {
    const rect = {
      x: Math.round(frame.x * input.canvasWidth),
      y: Math.round(frame.y * input.canvasHeight),
      width: Math.round(frame.width * input.canvasWidth),
      height: Math.round(frame.height * input.canvasHeight),
    };

    if (frame.role === "agent_headshot") {
      return imageObject("agent_headshot_image", "agent_headshot_image", rect, headshots[0], "circle");
    }
    if (frame.role === "secondary") {
      const src = listing[listingCursor++];
      return imageObject(`secondary_image_${secondaryCount++}`, "secondary_image", rect, src, "rect");
    }
    // primary
    const src = input.primarySrc ?? listing[listingCursor++];
    return imageObject("primary_image", "primary_image", rect, src, "rect");
  });
}

function imageObject(
  objectId: string,
  role: string,
  rect: FrameRect,
  src: string | undefined,
  clip: "rect" | "circle",
): AdStudioCanvasObject {
  return {
    objectId,
    type: "image",
    role,
    content: src,
    clip,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    locked: false,
  };
}

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
