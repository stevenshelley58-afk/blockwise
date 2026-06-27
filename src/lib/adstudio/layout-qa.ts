import type { AdStudioCanvasObject, AdStudioCreative } from "./types.ts";

export type LayoutQACheckName = "overlap" | "readability" | "cta" | "logo" | "safeZone";

export type LayoutQAIssue = {
  code: string;
  message: string;
  objectIds: string[];
};

export type LayoutQACheckResult = {
  pass: boolean;
  issues: LayoutQAIssue[];
};

export type LayoutOverlapPair = {
  a: string;
  b: string;
  overlapArea: number;
};

export type LayoutOverlapCheckResult = LayoutQACheckResult & {
  pairs: LayoutOverlapPair[];
};

export type LayoutReadabilityCheckResult = LayoutQACheckResult & {
  textBlocks: Array<{
    objectId: string;
    role: string;
    estimatedLines: number;
    requiredHeight: number;
    actualHeight: number;
  }>;
};

export type LayoutQAResult = {
  pass: boolean;
  checks: {
    overlap: LayoutOverlapCheckResult;
    readability: LayoutReadabilityCheckResult;
    cta: LayoutQACheckResult;
    logo: LayoutQACheckResult;
    safeZone: LayoutQACheckResult;
  };
  issueCount: number;
};

type Rect = {
  objectId: string;
  role: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const FOREGROUND_ROLES = new Set(["headline", "subheadline", "cta_button", "cta_text", "brand_logo"]);

export function runLayoutQA(creative: AdStudioCreative): LayoutQAResult {
  const checks = {
    overlap: checkLayoutOverlap(creative),
    readability: checkLayoutReadability(creative),
    cta: checkLayoutCta(creative),
    logo: checkLayoutLogo(creative),
    safeZone: checkLayoutSafeZones(creative),
  };
  const issueCount = Object.values(checks).reduce((total, check) => total + check.issues.length, 0);

  return {
    pass: Object.values(checks).every((check) => check.pass),
    checks,
    issueCount,
  };
}

export function checkLayoutOverlap(creative: AdStudioCreative): LayoutOverlapCheckResult {
  const rects = creative.canvas.objects.filter(isForegroundObject).map(rectForObject);
  const pairs: LayoutOverlapPair[] = [];
  const issues: LayoutQAIssue[] = [];

  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i]!;
      const b = rects[j]!;
      if (isAllowedContainedPair(a, b)) continue;

      const overlapArea = rectOverlapArea(a, b);
      if (overlapArea <= 0) continue;
      pairs.push({ a: a.objectId, b: b.objectId, overlapArea });
      issues.push({
        code: "layout_overlap",
        message: `${a.role} overlaps ${b.role}.`,
        objectIds: [a.objectId, b.objectId],
      });
    }
  }

  return { pass: issues.length === 0, issues, pairs };
}

export function checkLayoutReadability(creative: AdStudioCreative): LayoutReadabilityCheckResult {
  const issues: LayoutQAIssue[] = [];
  const textBlocks = creative.canvas.objects
    .filter((object) => object.type === "text" && ["headline", "subheadline", "cta_text"].includes(object.role))
    .map((object) => {
      const fontSize = object.size ?? 32;
      const widthFactor = object.role === "headline" ? 0.56 : 0.5;
      const lineHeightFactor = object.role === "headline" ? 1.08 : 1.22;
      const estimatedLines = estimateLayoutWrappedLineCount(object.content ?? "", object.width, fontSize, widthFactor);
      const requiredHeight = Math.round(estimatedLines * fontSize * lineHeightFactor);
      const actualHeight = object.height ?? Math.round(fontSize * lineHeightFactor);

      if (!(object.content ?? "").trim()) {
        issues.push({
          code: "layout_text_empty",
          message: `${object.role} text is empty.`,
          objectIds: [object.objectId],
        });
      }

      if (actualHeight < requiredHeight) {
        issues.push({
          code: "layout_text_clipped",
          message: `${object.role} text height is too small for estimated wrapping.`,
          objectIds: [object.objectId],
        });
      }

      if (fontSize < minimumFontSizeForRole(object.role)) {
        issues.push({
          code: "layout_text_too_small",
          message: `${object.role} text is below the minimum readable size.`,
          objectIds: [object.objectId],
        });
      }

      return {
        objectId: object.objectId,
        role: object.role,
        estimatedLines,
        requiredHeight,
        actualHeight,
      };
    });

  return { pass: issues.length === 0, issues, textBlocks };
}

export function checkLayoutCta(creative: AdStudioCreative): LayoutQACheckResult {
  const issues: LayoutQAIssue[] = [];
  const button = creative.canvas.objects.find((object) => object.role === "cta_button");
  const text = creative.canvas.objects.find((object) => object.role === "cta_text");

  if (!button) {
    issues.push({ code: "layout_cta_missing_button", message: "CTA button is missing.", objectIds: [] });
  }
  if (!text || !(text.content ?? "").trim()) {
    issues.push({ code: "layout_cta_missing_text", message: "CTA text is missing.", objectIds: text ? [text.objectId] : [] });
  }
  if (button && (button.width < 180 || (button.height ?? 0) < 48)) {
    issues.push({ code: "layout_cta_too_small", message: "CTA button is too small.", objectIds: [button.objectId] });
  }
  if (button && text && !rectContains(rectForObject(button), rectForObject(text), 0)) {
    issues.push({
      code: "layout_cta_text_outside_button",
      message: "CTA text must stay inside the CTA button.",
      objectIds: [button.objectId, text.objectId],
    });
  }

  return { pass: issues.length === 0, issues };
}

export function checkLayoutLogo(creative: AdStudioCreative): LayoutQACheckResult {
  const issues: LayoutQAIssue[] = [];
  const logo = creative.canvas.objects.find((object) => object.role === "brand_logo");

  if (!logo) {
    return {
      pass: false,
      issues: [{ code: "layout_logo_missing", message: "Brand logo is missing.", objectIds: [] }],
    };
  }

  if (logo.width < 96 || (logo.height ?? 0) < 32) {
    issues.push({ code: "layout_logo_too_small", message: "Brand logo is too small.", objectIds: [logo.objectId] });
  }
  if (!isInsideCanvas(rectForObject(logo), creative.canvas.width, creative.canvas.height, 0)) {
    issues.push({ code: "layout_logo_outside_canvas", message: "Brand logo is outside the canvas.", objectIds: [logo.objectId] });
  }

  return { pass: issues.length === 0, issues };
}

export function checkLayoutSafeZones(creative: AdStudioCreative): LayoutQACheckResult {
  const issues: LayoutQAIssue[] = [];
  const canvas = creative.canvas;
  const margin = Math.round(Math.min(canvas.width, canvas.height) * 0.035);
  const storyTop = creative.format === "9:16" ? 150 : 0;
  const storyBottom = creative.format === "9:16" ? 260 : 0;
  const demandGenBottom = creative.safeZones.googleDemandGen ? Math.round(canvas.height * 0.04) : 0;
  const bottomSafe = Math.max(storyBottom, demandGenBottom);

  for (const object of canvas.objects.filter(isForegroundObject)) {
    const rect = rectForObject(object);
    if (!isInsideCanvas(rect, canvas.width, canvas.height, margin)) {
      issues.push({
        code: "layout_object_outside_safe_zone",
        message: `${object.role} is outside the canvas safe zone.`,
        objectIds: [object.objectId],
      });
    }

    if (rect.y < storyTop || rect.y + rect.height > canvas.height - bottomSafe) {
      issues.push({
        code: "layout_object_in_platform_safe_zone",
        message: `${object.role} crosses a platform safe zone.`,
        objectIds: [object.objectId],
      });
    }
  }

  return { pass: issues.length === 0, issues };
}

function isForegroundObject(object: AdStudioCanvasObject): boolean {
  return FOREGROUND_ROLES.has(object.role);
}

function rectForObject(object: AdStudioCanvasObject): Rect {
  const height = object.height ?? (object.type === "text" ? Math.round((object.size ?? 32) * 1.22) : object.width);
  return {
    objectId: object.objectId,
    role: object.role,
    x: object.x,
    y: object.y,
    width: object.width,
    height,
  };
}

function isAllowedContainedPair(a: Rect, b: Rect): boolean {
  const roles = new Set([a.role, b.role]);
  return roles.has("cta_button") && roles.has("cta_text");
}

function rectOverlapArea(a: Rect, b: Rect): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

function rectContains(container: Rect, child: Rect, padding: number): boolean {
  return (
    child.x >= container.x + padding &&
    child.y >= container.y + padding &&
    child.x + child.width <= container.x + container.width - padding &&
    child.y + child.height <= container.y + container.height - padding
  );
}

function isInsideCanvas(rect: Rect, width: number, height: number, margin: number): boolean {
  return (
    rect.x >= margin &&
    rect.y >= margin &&
    rect.x + rect.width <= width - margin &&
    rect.y + rect.height <= height - margin
  );
}

function minimumFontSizeForRole(role: string): number {
  if (role === "headline") return 42;
  if (role === "cta_text") return 22;
  return 24;
}

function estimateLayoutWrappedLineCount(text: string, maxWidth: number, fontSize: number, widthFactor = 0.52): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;

  const spaceWidth = fontSize * 0.3;
  let lines = 1;
  let currentWidth = 0;

  for (const word of words) {
    const wordWidth = Math.max(fontSize, word.length * fontSize * widthFactor);
    if (currentWidth === 0) {
      currentWidth = wordWidth;
      continue;
    }

    const nextWidth = currentWidth + spaceWidth + wordWidth;
    if (nextWidth <= maxWidth) {
      currentWidth = nextWidth;
    } else {
      lines += 1;
      currentWidth = wordWidth;
    }
  }

  return lines;
}
