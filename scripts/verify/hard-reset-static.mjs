#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const failures = [];

const activeRuntimeRoots = ["src", "workers", "hermes/skills"];
const customerRoots = ["src/app/(customer)", "src/components"];
const ignoredSegments = new Set([
  ".git", ".next", ".tools", ".trigger", "node_modules",
  "playwright-report", "test-results", "_archive",
]);

// Phase 1 — AdStudio clean-rebuild: must not contain any legacy clone identifiers.
checkLegacyCloneIdentifiers();
// Existing checks (kept from pre-rebuild verifier).
checkLegacyAdFirstReferences();
checkCustomerInternalFieldReferences();
checkCustomerDataSourceBoundaries();
checkHermesQueueWorkerContract();

if (failures.length > 0) {
  console.error("Hard-reset static verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Hard-reset static verification passed.");

// ---------------------------------------------------------------------------
// Phase 1: AdStudio clean-rebuild — zero legacy clone identifiers
// ---------------------------------------------------------------------------

function checkLegacyCloneIdentifiers() {
  const strictLegacyIdentifiers = [
    "reference_clone", "reference-clone",
    "buildCloneImageRequest", "buildTargetedEditRequest",
    "template_clone_image", "templateClone", "cloneQa",
    "adstudio/clones",
    "AD_STUDIO_TEMPLATES", "RESOLVABLE_AD_STUDIO_TEMPLATES",
    "adstudio.generate.template",
  ];

  const legacyPaths = [
    "src/lib/adstudio/template-gallery",
    "src/lib/adstudio/reference-clone.ts",
    "src/lib/adstudio/clone-generation.ts",
    "src/lib/adstudio/clone-campaign.ts",
    "src/lib/adstudio/clone-creative.ts",
    "src/lib/adstudio/clone-regions.ts",
    "src/lib/adstudio/region-edit.ts",
    "src/lib/adstudio/rasterize-reference.ts",
    "src/lib/adstudio/generate-template-campaign.ts",
    "src/lib/adstudio/template-resolver.ts",
    "src/lib/adstudio/template-preview.ts",
    "src/lib/adstudio/creative-preview.ts",
    "src/lib/adstudio/creative-export.ts",
    "src/lib/adstudio/export-package.ts",
    "src/lib/adstudio/export-render-storage.ts",
    "src/lib/adstudio/generated-media.ts",
    "src/lib/adstudio/generation-credits.ts",
    "src/lib/adstudio/generation-error.ts",
    "src/lib/adstudio/generation-lock.ts",
    "src/lib/adstudio/live-workflow.ts",
    "src/lib/adstudio/offers.ts",
    "src/lib/adstudio/platform-rules.ts",
    "src/lib/adstudio/scoring.ts",
    "src/lib/adstudio/templates.ts",
    "src/lib/adstudio/template-display.ts",
    "src/lib/adstudio/readiness.ts",
    "src/lib/adstudio/job-status.ts",
    "src/lib/adstudio/clone-candidate-audit.ts",
    "src/lib/adstudio/clone-quality-gate.ts",
    "src/lib/adstudio/empty-campaign.ts",
    "src/lib/adstudio/first-ad-input.ts",
    "src/lib/adstudio/load-live-bundle.ts",
    "src/lib/adstudio/layer-derivation.ts",
    "src/lib/adstudio/magic-layers-config.mjs",
    "src/lib/adstudio/outpaint-layout.ts",
    "src/lib/adstudio/resolve-image-for-model.ts",
    "src/lib/adstudio/smart-crop.ts",
    "src/lib/adstudio/text-layers.ts",
    "src/lib/adstudio/text-layer-state.ts",
    "src/lib/adstudio/creative-library.ts",
    "src/lib/adstudio/creative-revisions.ts",
    "public/adstudio-samples",
    "scripts/adstudio/create-template.mjs",
    "scripts/adstudio/local-template-adapter.mjs",
    "scripts/build/rasterize-adstudio-samples.mjs",
    "scripts/verify/adstudio-templates.mjs",
    "hermes/skills/adstudio-template-builder/SKILL.md",
    ".github/codex/prompts/adstudio-template-integrator.md",
    "mockups/qwen-adstudio-full-process-20260722",
    "src/app/api/adstudio/jobs",
    "src/app/api/adstudio/creatives/[id]/edit",
    "src/app/api/adstudio/campaigns/route.ts",
    "src/app/api/adstudio/campaigns/[id]/draft",
    "src/app/api/adstudio/export-packages",
    "src/components/adstudio/ad-studio-workbench.tsx",
    "src/components/adstudio/new-ad-dialog.tsx",
    "src/components/adstudio/canvas/in-place-ad-editor.tsx",
    "src/app/api/operator/template-trace",
  ];

  for (const legacyPath of legacyPaths) {
    const full = join(root, ...legacyPath.split("/"));
    if (existsSync(full)) {
      failures.push(`Legacy AdStudio path still exists: ${display(full)}`);
    }
  }

  const scanRoots = ["src", "tests", "scripts", "trigger", "hermes/tools"];
  for (const file of filesUnder(scanRoots)) {
    if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(file)) continue;
    // Skip the verifier itself and files that reference job kind strings
    const normalized = file.replace(/\\/g, "/");
    if (normalized.includes("scripts/verify/hard-reset-static")) continue;
    if (normalized.includes("worker/index.ts")) continue;
    if (normalized.includes("tests/vps-job-queue-config")) continue;
    const text = stripComments(readFileSync(file, "utf8"));
    const hits = strictLegacyIdentifiers.filter((id) => text.includes(id));
    if (hits.length > 0) {
      failures.push(`${display(file)} contains legacy clone identifier: ${hits.join(", ")}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Below: existing verifier checks (kept from pre-rebuild).
// ---------------------------------------------------------------------------

function checkLegacyAdFirstReferences() {
  const forbidden = [
    /\bapify\b/i, /\bapify[-_]discovery\b/i, /\bad[-_\s]?first\b/i,
    /\blocation[-_\s]?dump\b/i, /\blocation[-_\s]?based\b/i, /\bmeta_ad_library_ui\b/i,
  ];
  for (const file of filesUnder(activeRuntimeRoots)) {
    const text = stripComments(readFileSync(file, "utf8"));
    const hits = forbidden.filter((pattern) => pattern.test(text)).map(String);
    if (hits.length > 0) {
      failures.push(`${display(file)} contains legacy ad-first/location source references: ${hits.join(", ")}`);
    }
  }
}

function checkCustomerInternalFieldReferences() {
  const forbidden = [
    /\bsource_provider\b/i, /\braw_payload\b/i, /\bpayload_hash\b/i,
    /\bsource_document_id\b/i, /\bad_snapshot_id\b/i, /\bad_fetch_run_id\b/i,
    /\bobserved_ad_id\b/i, /\badvertiser_page_id\b/i, /\bad_creative_id\b/i,
    /\bexternal_ad_id\b/i, /Ad\s*\{\s*row\.external_ad_id\s*\}/,
  ];
  for (const file of filesUnder(customerRoots)) {
    if (!/\.(?:ts|tsx|js|jsx|mdx)$/i.test(file)) continue;
    const text = readFileSync(file, "utf8");
    const hits = forbidden.filter((pattern) => pattern.test(text)).map(String);
    if (hits.length > 0) {
      failures.push(`${display(file)} references customer-hidden internal fields: ${hits.join(", ")}`);
    }
  }
}

function checkCustomerDataSourceBoundaries() {
  const forbiddenSources = [
    "observed_ads", "ad_snapshots", "source_documents", "ad_fetch_runs",
    "ingest_events", "coverage_defects", "agent_decisions",
  ];
  for (const file of filesUnder(["src/app/(customer)"])) {
    if (!/\.(?:ts|tsx)$/i.test(file)) continue;
    const text = stripComments(readFileSync(file, "utf8"));
    const hits = forbiddenSources.filter((source) =>
      new RegExp(`\\.from\\(\\s*["']${source}["']\\s*\\)`, "i").test(text),
    );
    if (hits.length > 0) {
      failures.push(`${display(file)} queries internal research tables directly: ${hits.join(", ")}`);
    }
  }
}

function checkHermesQueueWorkerContract() {
  const runtimeFiles = {
    index: "hermes/tools/research-runtime/src/index.ts",
    supervisor: "hermes/tools/research-runtime/src/supervisor.ts",
    types: "hermes/tools/research-runtime/src/types.ts",
    worker: "hermes/tools/research-runtime/src/worker.ts",
  };
  const captureFiles = [
    "hermes/tools/meta-library-capture/bin/capture.mjs",
    "hermes/tools/meta-library-capture/src/crawler.mjs",
    "hermes/tools/meta-library-capture/src/graphql.mjs",
    "hermes/tools/meta-library-capture/src/map-ad.mjs",
    "hermes/tools/meta-library-capture/src/outcome.mjs",
  ];
  const runtimeText = Object.fromEntries(
    Object.entries(runtimeFiles).map(([name, path]) => [name, stripComments(readFileSync(join(root, path), "utf8"))]),
  );
  const captureRuntime = captureFiles
    .map((path) => stripComments(readFileSync(join(root, path), "utf8")))
    .join("\n");

  if (!/export\s+\*\s+from\s+["']\.\/worker\.ts["']/.test(runtimeText.index)) {
    failures.push("Hermes research runtime must export its queue worker entrypoint from src/index.ts");
  }
  if (!/class\s+ResearchQueueWorker\b/.test(runtimeText.worker) || !/async\s+workOnce\s*\(/.test(runtimeText.worker)) {
    failures.push("Hermes research runtime must provide a ResearchQueueWorker.workOnce queue entrypoint");
  }

  const requiredKinds = ["blockwise-agent-census", "blockwise-page-resolver", "blockwise-ad-collector", "blockwise-media-collector", "blockwise-ad-classifier"];
  for (const kind of requiredKinds) {
    if (!new RegExp(`["']${kind}["']`).test(runtimeText.types)) {
      failures.push(`Hermes researchJobInputSchema must include ${kind}`);
    }
  }

  const requiredPlannerMethods = ["planPostcodeRosterRefresh", "planPageResolution", "planResolvedAdvertiserCapture", "planCreativeClassification"];
  for (const method of requiredPlannerMethods) {
    if (!new RegExp(`\\b${method}\\s*\\(`).test(runtimeText.supervisor)) {
      failures.push(`Hermes ResearchSupervisor must include ${method}`);
    }
  }
  if (!/\bplan\w*Media\w*\s*\(/.test(runtimeText.supervisor)) {
    failures.push("Hermes ResearchSupervisor must include a media queue planner between collector and classifier");
  }

  const collectorRuntime = `${schemaBlock(runtimeText.types, "adCollectorPayloadSchema", "locationSearchGateSchema")}\n${captureRuntime}`;
  const forbiddenCollectionInputs = [/\bsearchQuery\b/i, /\bsearch_query\b/i, /\bradius\b/i, /\bgeo\b/i, /\blocation\b/i]
    .filter((pattern) => pattern.test(collectorRuntime)).map(String);
  if (forbiddenCollectionInputs.length > 0) {
    failures.push(`Hermes active collection runtime accepts location/search-query inputs: ${forbiddenCollectionInputs.join(", ")}`);
  }
}

function schemaBlock(text, startName, nextName) {
  const start = text.indexOf(`export const ${startName}`);
  if (start < 0) return "";
  const end = text.indexOf(`export const ${nextName}`, start + 1);
  return end < 0 ? text.slice(start) : text.slice(start, end);
}

function filesUnder(roots) { return roots.flatMap((rootPath) => walk(join(root, rootPath))); }

function walk(path) {
  let stat;
  try { stat = statSync(path); } catch { return []; }
  const rel = relative(root, path);
  if (rel.split(/[\\/]/u).some((part) => ignoredSegments.has(part))) return [];
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];
  return readdirSync(path).flatMap((name) => walk(join(path, name)));
}

function stripComments(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");
}

function display(path) { return relative(root, path).replace(/\\/g, "/"); }
