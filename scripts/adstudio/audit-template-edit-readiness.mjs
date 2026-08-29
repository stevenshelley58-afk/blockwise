#!/usr/bin/env node

// Read-only inventory for the staged deterministic-editor migration. This is
// deliberately stricter than the general gallery gate: it reports every
// declared customer input that cannot yet be edited from verified offline
// evidence. It never writes templates or changes a template's release status.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  MAGIC_LAYER_MIN_FONT_FIT,
  MAGIC_LAYER_MIN_REGION_CONFIDENCE,
} from "../../src/lib/adstudio/magic-layers-config.mjs";

const galleryDir = resolve(process.env.ADSTUDIO_GALLERY_DIR ?? "src/lib/adstudio/template-gallery");

function usage(message) {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write("Usage: node scripts/adstudio/audit-template-edit-readiness.mjs [--template <id[,id...]>] [--output <path>]\n");
  process.exit(message ? 2 : 0);
}

function parseArgs(argv) {
  const templateIds = new Set();
  let outputPath = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") usage();
    if (argument === "--template" || argument.startsWith("--template=")) {
      const value = argument === "--template" ? argv[++index] : argument.slice("--template=".length);
      if (!value) usage("--template needs at least one template id");
      for (const id of value.split(",").map((entry) => entry.trim()).filter(Boolean)) templateIds.add(id);
      continue;
    }
    if (argument === "--output" || argument.startsWith("--output=")) {
      outputPath = argument === "--output" ? argv[++index] : argument.slice("--output=".length);
      if (!outputPath) usage("--output needs a path");
      continue;
    }
    usage(`Unknown argument: ${argument}`);
  }
  return { templateIds, outputPath };
}

function isNormalizedBox(box) {
  return Boolean(box)
    && [box.x, box.y, box.width, box.height].every(Number.isFinite)
    && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0
    && box.x + box.width <= 1.001 && box.y + box.height <= 1.001;
}

function overlapRatio(left, right) {
  const overlapWidth = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const overlapHeight = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const overlapArea = overlapWidth * overlapHeight;
  const smallerArea = Math.min(left.width * left.height, right.width * right.height);
  return smallerArea > 0 ? overlapArea / smallerArea : 0;
}

function textInputAudit(field, typography) {
  const spec = typography?.[field.key];
  const blockers = [];
  if (!spec || typeof spec !== "object") {
    blockers.push("missing_typography_spec");
  } else {
    if (!isNormalizedBox(spec.sampleBox)) blockers.push("missing_or_invalid_sample_box");
    if (!Number.isFinite(spec.measurementVersion) || spec.measurementVersion < 2) blockers.push("legacy_typography_measurement");
    if (spec.measurementSource !== "ocr-v2" && spec.measurementSource !== "manual-verified") {
      blockers.push("missing_verified_measurement_provenance");
    }
    if (
      !Array.isArray(spec.measuredLines)
      || spec.measuredLines.length !== Math.max(1, spec.sampleLineCount)
      || spec.measuredLines.some((line) => (
        typeof line?.text !== "string"
        || !line.text.trim()
        || !isNormalizedBox(line.sampleBox)
        || !Number.isFinite(line.sizeRatio)
        || line.sizeRatio <= 0
      ))
    ) blockers.push("missing_or_invalid_per_line_typography");
    if (!Number.isFinite(spec.fitScore) || spec.fitScore < MAGIC_LAYER_MIN_FONT_FIT) blockers.push("font_fit_below_threshold");
    if (!Number.isFinite(spec.detectionScore) || spec.detectionScore < MAGIC_LAYER_MIN_REGION_CONFIDENCE) blockers.push("region_confidence_below_threshold");
    if (typeof spec.fontFile !== "string" || !spec.fontFile.trim()) blockers.push("missing_self_hosted_font");
  }
  return { key: field.key, label: field.label, required: Boolean(field.required), ready: blockers.length === 0, blockers };
}

function imageInputAudit(field, imageBoxes) {
  const blockers = isNormalizedBox(imageBoxes?.[field.key]) ? [] : ["missing_or_invalid_editor_hitbox"];
  return { key: field.key, label: field.label, required: Boolean(field.required), ready: blockers.length === 0, blockers };
}

function auditTemplate(template, fileName) {
  const templateId = template?.id ?? fileName.replace(/\.json$/u, "");
  const text = Array.isArray(template?.inputs?.text) ? template.inputs.text : [];
  const images = Array.isArray(template?.inputs?.images) ? template.inputs.images : [];
  const typography = template?.typography;
  const editing = template?.deterministicEditing;
  const textInputs = text.map((field) => textInputAudit(field, typography));
  const imageInputs = images.map((field) => imageInputAudit(field, editing?.imageBoxes));
  const blockers = [
    ...textInputs.flatMap((field) => field.blockers.map((blocker) => `text.${field.key}.${blocker}`)),
    ...imageInputs.flatMap((field) => field.blockers.map((blocker) => `image.${field.key}.${blocker}`)),
  ];
  const measuredTextBoxes = text.flatMap((field) => {
    const box = typography?.[field.key]?.sampleBox;
    return isNormalizedBox(box) ? [{ key: field.key, box }] : [];
  });
  for (let left = 0; left < measuredTextBoxes.length; left += 1) {
    for (let right = left + 1; right < measuredTextBoxes.length; right += 1) {
      if (overlapRatio(measuredTextBoxes[left].box, measuredTextBoxes[right].box) > 0.05) {
        blockers.push(`text.${measuredTextBoxes[left].key}.overlaps.${measuredTextBoxes[right].key}`);
      }
    }
  }
  const hasOfflineEvidence = typography !== undefined || editing !== undefined;
  if (editing?.status !== "ready") blockers.unshift("template.deterministic_editing_not_ready");
  for (const key of Object.keys(typography ?? {})) {
    if (!text.some((field) => field.key === key)) blockers.push(`typography.${key}.undeclared_input`);
  }
  for (const key of Object.keys(editing?.imageBoxes ?? {})) {
    if (!images.some((field) => field.key === key)) blockers.push(`image_box.${key}.undeclared_input`);
  }
  const status = blockers.length === 0 ? "ready" : hasOfflineEvidence ? "partial" : "legacy";
  return {
    templateId,
    status,
    declaredInputs: { text: textInputs, images: imageInputs },
    blockers,
  };
}

async function main() {
  const { templateIds, outputPath } = parseArgs(process.argv.slice(2));
  const fileNames = (await readdir(galleryDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^meta-.*\.json$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const selected = templateIds.size
    ? fileNames.filter((fileName) => templateIds.has(fileName.replace(/\.json$/u, "")))
    : fileNames;
  const selectedIds = new Set(selected.map((fileName) => fileName.replace(/\.json$/u, "")));
  const unknown = [...templateIds].filter((id) => !selectedIds.has(id));
  if (unknown.length) usage(`Unknown template id(s): ${unknown.join(", ")}`);

  const templates = [];
  for (const fileName of selected) {
    const template = JSON.parse(await readFile(join(galleryDir, fileName), "utf8"));
    templates.push(auditTemplate(template, fileName));
  }
  const inputs = templates.flatMap((template) => [
    ...template.declaredInputs.text,
    ...template.declaredInputs.images,
  ]);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    galleryDir,
    selection: templateIds.size ? [...templateIds].sort() : "all",
    thresholds: {
      minFontFit: MAGIC_LAYER_MIN_FONT_FIT,
      minRegionConfidence: MAGIC_LAYER_MIN_REGION_CONFIDENCE,
    },
    summary: {
      templates: templates.length,
      ready: templates.filter((template) => template.status === "ready").length,
      partial: templates.filter((template) => template.status === "partial").length,
      legacy: templates.filter((template) => template.status === "legacy").length,
      declaredTextInputs: templates.reduce((total, template) => total + template.declaredInputs.text.length, 0),
      declaredImageInputs: templates.reduce((total, template) => total + template.declaredInputs.images.length, 0),
      readyInputs: inputs.filter((input) => input.ready).length,
      blockedInputs: inputs.filter((input) => !input.ready).length,
      blockers: templates.reduce((total, template) => total + template.blockers.length, 0),
    },
    templates,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    const resolvedOutput = resolve(outputPath);
    await mkdir(resolve(resolvedOutput, ".."), { recursive: true });
    await writeFile(resolvedOutput, serialized);
    process.stderr.write(`Wrote ${resolvedOutput}\n`);
  } else {
    process.stdout.write(serialized);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});
