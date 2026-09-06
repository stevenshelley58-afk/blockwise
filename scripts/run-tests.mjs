#!/usr/bin/env node
// Collect the unit/contract suite and hand an explicit file list to the Node
// test runner.
//
// The suite used to be selected by passing glob patterns straight to
// `node --test`. That is not portable: on Linux the npm script shell expands
// the patterns first, and POSIX sh has no `**`, so `tests/**/*.test.mjs`
// collapsed to `tests/*/*.test.mjs`. Because that matched the nested .mjs
// tests, the pattern never reached Node's own globber and all 15 top-level
// `tests/*.test.mjs` files were silently skipped in CI while still running on
// Windows, where cmd.exe leaves the pattern alone. Resolving the files here
// keeps every platform on the same list.

import { spawn } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".git"]);
const isTestFile = (name) => name.endsWith(".test.ts") || name.endsWith(".test.mjs");

function collect(dir, found = []) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collect(join(dir, entry.name), found);
    } else if (entry.isFile() && isTestFile(entry.name)) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

const searchRoots = [resolve(root, "tests")];
const packagesDir = resolve(root, "packages");
if (existsSync(packagesDir)) {
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      searchRoots.push(join(packagesDir, entry.name, "src"));
    }
  }
}

const files = searchRoots
  .flatMap((dir) => collect(dir))
  .map((file) => relative(root, file).split(sep).join("/"))
  .sort();

if (files.length === 0) {
  console.error("run-tests: no test files found");
  process.exit(1);
}

console.log(`run-tests: ${files.length} test files`);

const child = spawn(
  process.execPath,
  ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--test", ...files, ...process.argv.slice(2)],
  { cwd: root, stdio: "inherit" },
);
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
