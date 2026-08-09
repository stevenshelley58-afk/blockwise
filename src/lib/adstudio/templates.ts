import type { AdStudioFormat, AdStudioGoal, MetaLeadAdPack } from "./types.ts";
import { RAW_ADSTUDIO_GALLERY_TEMPLATES } from "./template-gallery/index.ts";
import rawQualityLocks from "./template-gallery/quality-locks.json" with { type: "json" };
import { templateDisplaySrc } from "./template-display.ts";
import {
  MAGIC_LAYER_MIN_FONT_FIT,
  MAGIC_LAYER_MIN_REGION_CONFIDENCE,
} from "./magic-layers-config.mjs";

export type AdStudioTemplateImageInput = {
  key: string;
  label: string;
  required: boolean;
  aspect?: "landscape" | "portrait" | "square";
  description: string;
};

export type AdStudioTemplateTextInput = {
  key: string;
  label: string;
  maxLength: number;
  sample: string;
  required: boolean;
};

export type AdStudioTemplateSourceAd = {
  creativeId?: string;
  file?: string;
  contentHash: string;
};

export type AdStudioTemplateClassification = {
  ad_type: string;
  primary_intent: string;
  property_or_agent_focus: string;
};

export type AdStudioTemplateSample = {
  imageSrc: string;
  thumbnailSrc: string;
  alt: string;
  contentHash: string;
  generatedBy: "reference_clone";
};

export type AdStudioTemplateMeta = MetaLeadAdPack & {
  objective: "OUTCOME_LEADS";
  publisherPlatforms: ["facebook", "instagram"];
  facebookPositions: string[];
  instagramPositions: string[];
};

/**
 * Per-text-region typography, built offline by
 * scripts/build/font-corpus/adstudio-type-specs.mjs (see
 * docs/plans/2026-07-27-adstudio-magic-layers-editor.md §7). This is a
 * best-effort real-font match against the sample image, not a rendering
 * recipe on its own — Phase 2 (the "mode: live|rerender" gating) decides
 * when a region is trustworthy enough to re-typeset with it. `fitScore`
 * (0-1, higher is better) tells that decision how close the pixel match
 * actually was; a region the build script couldn't confidently detect or
 * measure is simply absent from the map rather than given a guessed spec.
 */
export type AdStudioTypeSpec = {
  /** Version 2 normalizes sizeRatio to the full measured region box. */
  measurementVersion?: number;
  measurementSource?: "ocr-v2" | "manual-verified";
  measuredLines?: Array<{
    text: string;
    sampleBox: { x: number; y: number; width: number; height: number };
    sizeRatio: number;
    scaleX?: number;
  }>;
  fontId: string;
  family: string;
  fallbackFamily: "serif" | "sans-serif" | "monospace" | "cursive";
  weight: number;
  italic: boolean;
  case: "upper" | "lower" | "mixed" | "none";
  /** CSS font-size = (region box height in the consumer's own px) * sizeRatio. */
  sizeRatio: number;
  lineHeight: number;
  tracking: number;
  align: "left" | "center" | "right";
  color: string;
  fitScore: number;
  /** Text bounds measured once from the approved public sample. */
  sampleBox: { x: number; y: number; width: number; height: number };
  /** Number of wrapped lines in the approved sample copy. */
  sampleLineCount: number;
  /** OCR-to-declared-copy match confidence for sampleBox (0-1). */
  detectionScore: number;
  /** Self-hosted face used only when the fidelity gates pass. */
  fontFile?: string;
};

export type AdStudioTemplateRegionBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * An explicit release marker for templates whose declared customer inputs all
 * have verified editor regions and whose text fields never need an image-model
 * re-render. Image changes remain targeted image-model edits. This is only an
 * editor map: the approved sample image remains the rendering reference.
 *
 * Text boxes and type treatments live in `typography`; image hitboxes are
 * recorded here because an image input has no type spec.
 */
export type AdStudioDeterministicEditing = {
  status: "partial" | "ready";
  imageBoxes: Record<string, AdStudioTemplateRegionBox>;
};

export type AdStudioTemplateEditReadiness = {
  status: "legacy" | "partial" | "ready";
  issues: string[];
};

/**
 * The only AdStudio template contract.
 *
 * A template is a safe sample image plus the customer inputs needed to clone
 * it. It contains no second rendering recipe. The sample image is the design.
 */
export type AdStudioTemplate = {
  id: string;
  name: string;
  goal: AdStudioGoal;
  offerId: string;
  source: "builtin";
  status: "approved";
  format: "4:5" | "9:16";
  dimensions: {
    width: 1080;
    height: 1350 | 1920;
  };
  audienceIntent: string;
  category: string;
  tags: string[];
  sample: AdStudioTemplateSample;
  inputs: {
    images: AdStudioTemplateImageInput[];
    text: AdStudioTemplateTextInput[];
  };
  meta: AdStudioTemplateMeta;
  sourceAd: AdStudioTemplateSourceAd;
  classification: AdStudioTemplateClassification;
  /** Cryptographic identity of this manifest excluding this marker. Present
   * only after the template passes the two-stage release quality lock. */
  qualityLock?: { templateHash: string };
  /** Keyed by inputs.text[].key. Absent entirely for templates the offline build hasn't covered yet. */
  typography?: Record<string, AdStudioTypeSpec>;
  /**
   * Opt-in release marker for fully deterministic text and image editing.
   * It must not be set until every declared customer input has been measured.
   */
  deterministicEditing?: AdStudioDeterministicEditing;
};

export type AdStudioGalleryTemplate = AdStudioTemplate;

export const AD_STUDIO_QUALITY_RUBRIC_VERSION = "adstudio-subject-invariant-clone-v1";
export const MIN_AD_STUDIO_SYSTEM_LIKENESS = 9.5;
export const MIN_AD_STUDIO_STANDALONE_QUALITY = 9;

export type AdStudioTemplateQualityLock = {
  templateHash: string;
  templateContract: string;
  sampleHash: string;
  evidenceHash: string;
  sampleLikeness: number;
  sampleQuality: number;
  customerFixtureLikeness: number;
  customerFixtureQuality: number;
  qualifiedAt: string;
};

export type AdStudioTemplateQualityLockIndex = {
  schemaVersion: 1;
  templates: Record<string, AdStudioTemplateQualityLock>;
};

export const AD_STUDIO_TEMPLATES: AdStudioTemplate[] = RAW_ADSTUDIO_GALLERY_TEMPLATES.map(validateGalleryTemplate);
const qualityLockValidation = validateQualityLockIndex(rawQualityLocks, AD_STUDIO_TEMPLATES);
export const AD_STUDIO_QUALITY_LOCK_ISSUES = qualityLockValidation.issues;
export const QUALITY_LOCKED_AD_STUDIO_TEMPLATE_IDS = qualityLockValidation.templateIds;
export const RESOLVABLE_AD_STUDIO_TEMPLATES: AdStudioTemplate[] = AD_STUDIO_TEMPLATES.filter(
  (template) => template.status === "approved" && QUALITY_LOCKED_AD_STUDIO_TEMPLATE_IDS.has(template.id),
);

export function resolveAdStudioTemplate(templateId: string | undefined): AdStudioTemplate | null {
  if (!templateId) return null;
  return RESOLVABLE_AD_STUDIO_TEMPLATES.find((template) => template.id === templateId) ?? null;
}

export function isBuiltInAdStudioTemplate(templateId: string | undefined): boolean {
  return Boolean(resolveAdStudioTemplate(templateId));
}

export function builtInAdStudioTemplates(): AdStudioTemplate[] {
  return RESOLVABLE_AD_STUDIO_TEMPLATES.map((template) => ({
    ...template,
    sample: {
      ...template.sample,
      thumbnailSrc: templateDisplaySrc(template, "640"),
    },
  }));
}

export function resolvableAdStudioTemplates(): AdStudioTemplate[] {
  return [...RESOLVABLE_AD_STUDIO_TEMPLATES];
}

/**
 * Validate the checked-in release index without importing its evidence or any
 * private source assets into the customer bundle. The verifier performs the
 * cryptographic evidence checks; runtime selection fails closed to entries
 * whose lock metadata does not match the approved manifest sample.
 */
export function validateQualityLockIndex(
  raw: unknown,
  templates: readonly AdStudioTemplate[],
): { templateIds: ReadonlySet<string>; issues: string[] } {
  const issues: string[] = [];
  const templateIds = new Set<string>();
  if (!isRecord(raw) || raw.schemaVersion !== 1 || !isRecord(raw.templates)) {
    return {
      templateIds,
      issues: ["quality-lock index must have schemaVersion 1 and a templates object"],
    };
  }

  const templatesById = new Map(templates.map((template) => [template.id, template]));
  for (const [templateId, value] of Object.entries(raw.templates)) {
    const entryIssues: string[] = [];
    const template = templatesById.get(templateId);
    if (!template) entryIssues.push("does not match a built-in template");
    if (!isRecord(value)) {
      entryIssues.push("must be an object");
    } else {
      const expectedKeys = new Set([
        "templateHash",
        "templateContract",
        "sampleHash",
        "evidenceHash",
        "sampleLikeness",
        "sampleQuality",
        "customerFixtureLikeness",
        "customerFixtureQuality",
        "qualifiedAt",
      ]);
      const actualKeys = Object.keys(value);
      if (actualKeys.length !== expectedKeys.size || actualKeys.some((key) => !expectedKeys.has(key))) {
        entryIssues.push("has an invalid schema");
      }
      if (!isSha256(value.templateHash)) entryIssues.push("templateHash must be a SHA-256 hash");
      if (typeof value.templateContract !== "string" || value.templateContract !== templateContract(template)) {
        entryIssues.push("templateContract does not match the current manifest");
      }
      if (!isSha256(value.sampleHash)) entryIssues.push("sampleHash must be a SHA-256 hash");
      if (!isSha256(value.evidenceHash)) entryIssues.push("evidenceHash must be a SHA-256 hash");
      if (template && value.sampleHash !== template.sample.contentHash) {
        entryIssues.push("sampleHash does not match the approved manifest sample");
      }
      if (template && template.qualityLock?.templateHash !== value.templateHash) {
        entryIssues.push("templateHash does not match the qualified manifest contract");
      }
      validateQualityScore(value.sampleLikeness, MIN_AD_STUDIO_SYSTEM_LIKENESS, "sampleLikeness", entryIssues);
      validateQualityScore(value.sampleQuality, MIN_AD_STUDIO_STANDALONE_QUALITY, "sampleQuality", entryIssues);
      validateQualityScore(
        value.customerFixtureLikeness,
        MIN_AD_STUDIO_SYSTEM_LIKENESS,
        "customerFixtureLikeness",
        entryIssues,
      );
      validateQualityScore(
        value.customerFixtureQuality,
        MIN_AD_STUDIO_STANDALONE_QUALITY,
        "customerFixtureQuality",
        entryIssues,
      );
      if (!isIsoTimestamp(value.qualifiedAt)) entryIssues.push("qualifiedAt must be an ISO-8601 timestamp");
    }

    if (entryIssues.length === 0) templateIds.add(templateId);
    else issues.push(...entryIssues.map((issue) => `${templateId}: ${issue}`));
  }
  return { templateIds, issues };
}

/**
 * Classify the offline editor evidence without changing whether a template is
 * available in the gallery. Migration is staged: only an explicit `ready`
 * marker makes the strict deterministic contract release-blocking.
 */
export function deterministicEditingReadiness(template: AdStudioTemplate): AdStudioTemplateEditReadiness {
  const hasOfflineEditorEvidence = Boolean(template.deterministicEditing) || Boolean(template.typography);
  if (!template.deterministicEditing) {
    return { status: hasOfflineEditorEvidence ? "partial" : "legacy", issues: [] };
  }
  const issues = deterministicEditingIssues(template);
  return {
    status: template.deterministicEditing.status === "ready" && issues.length === 0
      ? "ready"
      : "partial",
    issues,
  };
}

/** Strict completeness checks used when a template opts into deterministic editing. */
export function deterministicEditingIssues(template: AdStudioTemplate): string[] {
  const issues: string[] = [];
  const editing = template.deterministicEditing;
  if (!editing) {
    issues.push("deterministicEditing metadata is missing");
    return issues;
  }

  const textKeys = new Set(template.inputs.text.map((input) => input.key));
  for (const input of template.inputs.text) {
    const spec = template.typography?.[input.key];
    if (!spec) {
      issues.push(`text input ${input.key} has no typography spec`);
      continue;
    }
    if (!isNormalizedBox(spec.sampleBox)) issues.push(`text input ${input.key} has no valid sampleBox`);
    if ((spec.measurementVersion ?? 0) < 2) {
      issues.push(`text input ${input.key} uses a legacy typography measurement`);
    }
    if (spec.measurementSource !== "ocr-v2" && spec.measurementSource !== "manual-verified") {
      issues.push(`text input ${input.key} has no verified measurement provenance`);
    }
    if (
      !Array.isArray(spec.measuredLines)
      || spec.measuredLines.length !== Math.max(1, spec.sampleLineCount)
      || spec.measuredLines.some((line) => (
        !line.text.trim()
        || !isNormalizedBox(line.sampleBox)
        || !Number.isFinite(line.sizeRatio)
        || line.sizeRatio <= 0
        || (line.scaleX !== undefined && (
          !Number.isFinite(line.scaleX)
          || line.scaleX < 0.5
          || line.scaleX > 1.5
        ))
      ))
    ) {
      issues.push(`text input ${input.key} has no valid per-line typography evidence`);
    }
    if (spec.fitScore < MAGIC_LAYER_MIN_FONT_FIT || spec.detectionScore < MAGIC_LAYER_MIN_REGION_CONFIDENCE) {
      issues.push(`text input ${input.key} does not meet the confidence threshold`);
    }
    if (!spec.fontFile?.trim()) issues.push(`text input ${input.key} has no self-hosted fontFile`);
  }
  for (const key of Object.keys(template.typography ?? {})) {
    if (!textKeys.has(key)) issues.push(`typography.${key} does not match a declared text input`);
  }
  const textBoxes = template.inputs.text.flatMap((input) => {
    const box = template.typography?.[input.key]?.sampleBox;
    return isNormalizedBox(box) ? [{ key: input.key, box }] : [];
  });
  for (let left = 0; left < textBoxes.length; left += 1) {
    for (let right = left + 1; right < textBoxes.length; right += 1) {
      if (overlapRatio(textBoxes[left]!.box, textBoxes[right]!.box) > 0.05) {
        issues.push(`text inputs ${textBoxes[left]!.key} and ${textBoxes[right]!.key} have overlapping editor boxes`);
      }
    }
  }

  const imageKeys = new Set(template.inputs.images.map((input) => input.key));
  for (const input of template.inputs.images) {
    if (!isNormalizedBox(editing.imageBoxes?.[input.key])) {
      issues.push(`image input ${input.key} has no valid editor hitbox`);
    }
  }
  for (const key of Object.keys(editing.imageBoxes ?? {})) {
    if (!imageKeys.has(key)) issues.push(`deterministicEditing.imageBoxes.${key} does not match a declared image input`);
  }
  return issues;
}

export function validateGalleryTemplate(raw: AdStudioTemplate): AdStudioTemplate {
  const errors: string[] = [];
  const expectedHeight = raw?.format === "4:5" ? 1350 : raw?.format === "9:16" ? 1920 : null;

  if (!raw?.id) errors.push("id is required");
  if (!raw?.name) errors.push("name is required");
  if (raw?.status !== "approved") errors.push("status must be approved");
  if (raw?.source !== "builtin") errors.push("source must be builtin");
  if (raw?.dimensions?.width !== 1080 || raw?.dimensions?.height !== expectedHeight) {
    errors.push("dimensions do not match format");
  }
  if (!raw?.sample?.thumbnailSrc || !raw?.sample?.imageSrc) errors.push("sample image paths are required");
  if (raw?.sample?.generatedBy !== "reference_clone") errors.push("sample must be generated by reference clone");
  if (!isSha256(raw?.sourceAd?.contentHash)) errors.push("sourceAd.contentHash must be a SHA-256 hash");
  if (!isSha256(raw?.sample?.contentHash)) errors.push("sample.contentHash must be a SHA-256 hash");
  if (raw?.sourceAd?.contentHash === raw?.sample?.contentHash) errors.push("gallery sample must not be the source ad");
  if (!raw?.sourceAd?.creativeId && !raw?.sourceAd?.file) errors.push("sourceAd provenance is required");
  if (!Array.isArray(raw?.inputs?.images) || raw.inputs.images.length === 0) errors.push("at least one image input is required");
  if (!raw?.inputs?.images?.some((input) => input.required)) errors.push("at least one image input must be required");
  validateUniqueKeys(raw?.inputs?.images ?? [], "image", errors);
  validateUniqueKeys(raw?.inputs?.text ?? [], "text", errors);
  for (const field of raw?.inputs?.text ?? []) {
    if (!field.label?.trim() || !field.sample?.trim() || !Number.isInteger(field.maxLength) || field.maxLength < 1) {
      errors.push(`text input ${field.key || "<unknown>"} is invalid`);
    }
  }
  if (raw?.meta?.platform !== "meta") errors.push("meta platform must be meta");
  if (raw?.meta?.objective !== "OUTCOME_LEADS") errors.push("meta objective must be OUTCOME_LEADS");
  if (raw?.meta?.specialAdCategory !== "housing") errors.push("meta special ad category must be housing");
  if (raw?.qualityLock !== undefined && !isSha256(raw.qualityLock.templateHash)) {
    errors.push("qualityLock.templateHash must be a SHA-256 hash");
  }
  if (raw?.deterministicEditing !== undefined) {
    if (!(raw.deterministicEditing?.status === "partial" || raw.deterministicEditing?.status === "ready")) {
      errors.push("deterministicEditing.status must be partial or ready");
    } else if (raw.deterministicEditing.status === "ready") {
      errors.push(...deterministicEditingIssues(raw));
    } else {
      const imageKeys = new Set(raw.inputs.images.map((input) => input.key));
      for (const [key, box] of Object.entries(raw.deterministicEditing.imageBoxes ?? {})) {
        if (!imageKeys.has(key)) {
          errors.push(`deterministicEditing.imageBoxes.${key} does not match a declared image input`);
        } else if (!isNormalizedBox(box)) {
          errors.push(`deterministicEditing.imageBoxes.${key} is not a valid editor hitbox`);
        }
      }
    }
  }

  if (errors.length) {
    throw new Error(`Invalid AdStudio gallery template ${raw?.id ?? "<unknown>"}: ${errors.join("; ")}`);
  }

  return raw;
}

function validateUniqueKeys(items: Array<{ key: string; label: string }>, kind: string, errors: string[]): void {
  const keys = new Set<string>();
  for (const item of items) {
    const key = item.key?.trim();
    if (!key || !item.label?.trim()) {
      errors.push(`${kind} input key and label are required`);
      continue;
    }
    if (keys.has(key)) errors.push(`duplicate ${kind} input key: ${key}`);
    keys.add(key);
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/iu.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function validateQualityScore(value: unknown, minimum: number, name: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > 10) {
    errors.push(`${name} must be between ${minimum} and 10`);
  }
}

function templateContract(template: AdStudioTemplate | undefined): string {
  if (!template) return "";
  const { qualityLock: _qualityLock, ...contract } = template;
  return canonicalJson(contract);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isNormalizedBox(value: unknown): value is AdStudioTemplateRegionBox {
  if (!value || typeof value !== "object") return false;
  const box = value as AdStudioTemplateRegionBox;
  return [box.x, box.y, box.width, box.height].every(Number.isFinite)
    && box.x >= 0
    && box.y >= 0
    && box.width > 0
    && box.height > 0
    && box.x + box.width <= 1.001
    && box.y + box.height <= 1.001;
}

function overlapRatio(left: AdStudioTemplateRegionBox, right: AdStudioTemplateRegionBox): number {
  const overlapWidth = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const overlapHeight = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const overlapArea = overlapWidth * overlapHeight;
  const smallerArea = Math.min(left.width * left.height, right.width * right.height);
  return smallerArea > 0 ? overlapArea / smallerArea : 0;
}

export type { AdStudioFormat };
