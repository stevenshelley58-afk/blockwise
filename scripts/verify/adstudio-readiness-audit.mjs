#!/usr/bin/env node
/**
 * AdStudio Template Readiness Audit
 *
 * Scans every meta-*.json template in src/lib/adstudio/template-gallery/
 * and produces a machine-readable readiness report.
 *
 * Output:
 *   - .cache/adstudio-readiness-report.json  (machine-readable)
 *   - stdout summary                         (human-readable)
 *
 * Usage:  node scripts/verify/adstudio-readiness-audit.mjs
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..', '..');

// ── Paths ────────────────────────────────────────────────────────────────────
const GALLERY_DIR = join(ROOT, 'src', 'lib', 'adstudio', 'template-gallery');
const EVIDENCE_DIR = join(GALLERY_DIR, 'evidence');
const CACHE_DIR = join(ROOT, '.cache');
const REPORT_PATH = join(CACHE_DIR, 'adstudio-readiness-report.json');

// ── Gate thresholds (mirrored from magic-layers-config.mjs) ──────────────────
const MIN_FONT_FIT = 0.6;
const MIN_REGION_CONFIDENCE = 0.6;

// ── Helpers ──────────────────────────────────────────────────────────────────

function readTemplateFiles() {
  return readdirSync(GALLERY_DIR)
    .filter(f => /^meta-.*\.json$/.test(f))
    .sort();
}

function evidenceFiles() {
  if (!existsSync(EVIDENCE_DIR)) return [];
  return readdirSync(EVIDENCE_DIR);
}

function analyseTemplate(filePath, evidenceSet) {
  const raw = readFileSync(filePath, 'utf-8');
  const tpl = JSON.parse(raw);

  const id = tpl.id ?? basename(filePath, '.json');
  const format = tpl.format ?? 'unknown';

  // Text inputs
  const textInputs = tpl.inputs?.text ?? [];
  const totalTextInputs = textInputs.length;
  const textKeys = textInputs.map(t => t.key);

  // Typography map
  const typography = tpl.typography ?? {};
  const typographyKeys = Object.keys(typography);

  const textInputsWithTypography = textKeys.filter(k => k in typography).length;

  const textInputsWithFontFile = textKeys.filter(k => {
    const entry = typography[k];
    return entry && typeof entry.fontFile === 'string' && entry.fontFile.length > 0;
  }).length;

  const textInputsPassingLiveGates = textKeys.filter(k => {
    const entry = typography[k];
    if (!entry) return false;
    if (!entry.fontFile) return false;
    return (entry.fitScore ?? 0) >= MIN_FONT_FIT
        && (entry.detectionScore ?? 0) >= MIN_REGION_CONFIDENCE;
  }).length;

  // Image inputs
  const totalImageInputs = (tpl.inputs?.images ?? []).length;

  // Evidence
  const hasEvidence = evidenceSet.has(id);

  // deterministicOnly eligibility: ALL text inputs must have typography + fontFile + pass gates
  const deterministicOnlyEligible =
    totalTextInputs > 0 && textInputsPassingLiveGates === totalTextInputs;

  // Has the flag already set?
  const hasDeterministicOnly = tpl.deterministicOnly === true;

  // Low fitScore fields (< 0.15)
  const lowFitScoreFields = [];
  for (const k of textKeys) {
    const entry = typography[k];
    if (entry && typeof entry.fitScore === 'number' && entry.fitScore < 0.15) {
      lowFitScoreFields.push({ key: k, fitScore: entry.fitScore });
    }
  }

  // Missing typography entries
  const missingTypography = textKeys.filter(k => !(k in typography));

  return {
    id,
    format,
    totalTextInputs,
    textInputsWithTypography,
    textInputsWithFontFile,
    textInputsPassingLiveGates,
    totalImageInputs,
    hasEvidence,
    deterministicOnlyEligible,
    hasDeterministicOnly,
    lowFitScoreFields,
    missingTypography,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const templateFiles = readTemplateFiles();
  const evidenceSet = new Set(evidenceFiles().map(f => f.replace(/\.json$/, '')));

  const results = templateFiles.map(f => analyseTemplate(join(GALLERY_DIR, f), evidenceSet));

  // ── Aggregate stats ──────────────────────────────────────────────────────
  const totalTemplates = results.length;
  const eligibleCount = results.filter(r => r.deterministicOnlyEligible).length;

  let totalTextAll = 0;
  let totalWithTypography = 0;
  let totalWithFontFile = 0;
  for (const r of results) {
    totalTextAll += r.totalTextInputs;
    totalWithTypography += r.textInputsWithTypography;
    totalWithFontFile += r.textInputsWithFontFile;
  }
  const typographyCoveragePct = totalTextAll > 0
    ? ((totalWithTypography / totalTextAll) * 100).toFixed(1)
    : '0.0';
  const fontFileCoveragePct = totalTextAll > 0
    ? ((totalWithFontFile / totalTextAll) * 100).toFixed(1)
    : '0.0';

  const withMissingTypography = results.filter(r => r.missingTypography.length > 0);
  const withLowFitScore = results.filter(r => r.lowFitScoreFields.length > 0);
  const withoutEvidence = results.filter(r => !r.hasEvidence);

  // ── Write JSON report ────────────────────────────────────────────────────
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    gates: { minFontFit: MIN_FONT_FIT, minRegionConfidence: MIN_REGION_CONFIDENCE },
    summary: {
      totalTemplates,
      deterministicOnlyEligible: eligibleCount,
      typographyCoveragePct: parseFloat(typographyCoveragePct),
      fontFileCoveragePct: parseFloat(fontFileCoveragePct),
      totalTextInputs: totalTextAll,
      totalWithTypography,
      totalWithFontFile,
    },
    templates: results,
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');

  // ── Stdout summary ───────────────────────────────────────────────────────
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  AdStudio Template Readiness Audit');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Total templates scanned       : ${totalTemplates}`);
  console.log(`  Eligible for deterministicOnly: ${eligibleCount}`);
  console.log(`  Typography coverage           : ${typographyCoveragePct}%  (${totalWithTypography}/${totalTextAll} text inputs)`);
  console.log(`  FontFile coverage             : ${fontFileCoveragePct}%  (${totalWithFontFile}/${totalTextAll} text inputs)`);
  console.log('');

  if (withMissingTypography.length > 0) {
    console.log(`  Templates with missing typography (${withMissingTypography.length}):`);
    for (const r of withMissingTypography) {
      console.log(`    - ${r.id}  [${r.missingTypography.join(', ')}]`);
    }
    console.log('');
  } else {
    console.log('  Templates with missing typography : none');
    console.log('');
  }

  if (withLowFitScore.length > 0) {
    console.log(`  Templates with low fitScore fields (${withLowFitScore.length}):`);
    for (const r of withLowFitScore) {
      const details = r.lowFitScoreFields.map(f => `${f.key}=${f.fitScore}`).join(', ');
      console.log(`    - ${r.id}  [${details}]`);
    }
    console.log('');
  } else {
    console.log('  Templates with low fitScore fields: none');
    console.log('');
  }

  if (withoutEvidence.length > 0) {
    console.log(`  Templates without evidence (${withoutEvidence.length}):`);
    for (const r of withoutEvidence) {
      console.log(`    - ${r.id}`);
    }
    console.log('');
  } else {
    console.log('  Templates without evidence        : none');
    console.log('');
  }

  console.log(`  Report written to: ${REPORT_PATH}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
}

main();
