#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const failures = [];

const activeRuntimeRoots = ["src", "workers", "hermes/skills"];
const customerRoots = ["src/app/(customer)", "src/components"];
const ignoredSegments = new Set([
  ".git",
  ".next",
  ".tools",
  ".trigger",
  "node_modules",
  "playwright-report",
  "test-results",
  "_archive",
]);

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

function checkLegacyAdFirstReferences() {
  const forbidden = [
    /\bapify\b/i,
    /\bapify[-_]discovery\b/i,
    /\bad[-_\s]?first\b/i,
    /\blocation[-_\s]?dump\b/i,
    /\blocation[-_\s]?based\b/i,
    /\bmeta_ad_library_ui\b/i,
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
    /\bsource_provider\b/i,
    /\braw_payload\b/i,
    /\bpayload_hash\b/i,
    /\bsource_document_id\b/i,
    /\bad_snapshot_id\b/i,
    /\bad_fetch_run_id\b/i,
    /\bobserved_ad_id\b/i,
    /\badvertiser_page_id\b/i,
    /\bad_creative_id\b/i,
    /\bexternal_ad_id\b/i,
    /Ad\s*\{\s*row\.external_ad_id\s*\}/,
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
    "observed_ads",
    "ad_snapshots",
    "source_documents",
    "ad_fetch_runs",
    "ingest_events",
    "coverage_defects",
    "agent_decisions",
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
    capture: "hermes/tools/meta-library-capture/src/capture.ts",
    captureTypes: "hermes/tools/meta-library-capture/src/types.ts",
  };
  const runtimeText = Object.fromEntries(
    Object.entries(runtimeFiles).map(([name, path]) => [name, stripComments(readFileSync(join(root, path), "utf8"))]),
  );

  if (!/export\s+\*\s+from\s+["']\.\/worker\.ts["']/.test(runtimeText.index)) {
    failures.push("Hermes research runtime must export its queue worker entrypoint from src/index.ts");
  }
  if (!/class\s+ResearchQueueWorker\b/.test(runtimeText.worker) || !/async\s+workOnce\s*\(/.test(runtimeText.worker)) {
    failures.push("Hermes research runtime must provide a ResearchQueueWorker.workOnce queue entrypoint");
  }

  const requiredKinds = [
    "blockwise-agent-census",
    "blockwise-page-resolver",
    "blockwise-ad-collector",
    "blockwise-media-collector",
    "blockwise-ad-classifier",
  ];
  for (const kind of requiredKinds) {
    if (!new RegExp(`["']${kind}["']`).test(runtimeText.types)) {
      failures.push(`Hermes researchJobInputSchema must include ${kind}`);
    }
  }

  const requiredPlannerMethods = [
    "planPostcodeRosterRefresh",
    "planPageResolution",
    "planResolvedAdvertiserCapture",
    "planCreativeClassification",
  ];
  for (const method of requiredPlannerMethods) {
    if (!new RegExp(`\\b${method}\\s*\\(`).test(runtimeText.supervisor)) {
      failures.push(`Hermes ResearchSupervisor must include ${method}`);
    }
  }
  if (!/\bplan\w*Media\w*\s*\(/.test(runtimeText.supervisor)) {
    failures.push("Hermes ResearchSupervisor must include a media queue planner between collector and classifier");
  }

  const collectorRuntime = `${schemaBlock(runtimeText.types, "adCollectorPayloadSchema", "locationSearchGateSchema")}\n${runtimeText.capture}\n${runtimeText.captureTypes}`;
  const forbiddenCollectionInputs = [
    /\bsearchQuery\b/i,
    /\bsearch_query\b/i,
    /\bradius\b/i,
    /\bgeo\b/i,
    /\blocation\b/i,
  ].filter((pattern) => pattern.test(collectorRuntime)).map(String);
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

function filesUnder(roots) {
  return roots.flatMap((rootPath) => walk(join(root, rootPath)));
}

function walk(path) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return [];
  }

  const rel = relative(root, path);
  if (rel.split(/[\\/]/u).some((part) => ignoredSegments.has(part))) return [];

  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];

  return readdirSync(path).flatMap((name) => walk(join(path, name)));
}

function stripComments(value) {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");
}

function display(path) {
  return relative(root, path).replace(/\\/g, "/");
}
