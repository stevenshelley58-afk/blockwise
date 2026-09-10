import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_FILE = /\.test\.(?:tsx?|mjs)$/;
const IGNORED_DIRECTORIES = new Set([".git", "dist", "node_modules"]);

/**
 * Recursively returns Node test files in stable order. This deliberately does
 * not depend on the host shell's globstar support, which previously omitted
 * root-level .test.mjs files and every workspace test from `npm test`.
 */
export async function collectNodeTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : collectNodeTestFiles(path);
    }
    return entry.isFile() && TEST_FILE.test(entry.name) ? [path] : [];
  }));
  return files.flat().sort();
}

function parseScope(arguments_) {
  const scope = arguments_.find((argument) => argument.startsWith("--scope="))?.slice("--scope=".length);
  if (scope === "root" || scope === "packages" || scope === "all") return scope;
  throw new Error("Expected --scope=root, --scope=packages, or --scope=all");
}

function runNodeTests(root, files, useTsx = false) {
  if (files.length === 0) throw new Error("No test files found");
  const args = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];
  if (useTsx) args.push("--import", "tsx");
  args.push("--test", ...files.map((file) => relative(root, file)));
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export async function runNodeTestScope(root, scope) {
  if (scope === "root" || scope === "all") {
    const files = await collectNodeTestFiles(resolve(root, "tests"));
    // Native-strip-compatible tests use .test.ts; JSX/transformed imports use .test.tsx.
    const tsStatus = runNodeTests(root, files.filter((file) => file.endsWith(".ts")));
    const status = tsStatus === 0 ? runNodeTests(root, files.filter((file) => !file.endsWith(".ts")), true) : tsStatus;
    if (scope === "root" || status !== 0) return status;
  }

  const packagesDirectory = resolve(root, "packages");
  const packageEntries = await readdir(packagesDirectory, { withFileTypes: true });
  for (const entry of packageEntries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
    const packageDirectory = resolve(packagesDirectory, entry.name);
    const files = await collectNodeTestFiles(packageDirectory);
    if (files.length === 0) continue;
    const status = runNodeTests(packageDirectory, files, true);
    if (status !== 0) return status;
  }
  return 0;
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const status = await runNodeTestScope(root, parseScope(process.argv.slice(2)));
  process.exitCode = status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
