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
