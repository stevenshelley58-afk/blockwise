import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const TEXT_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|json|md|mdx|html|svg|ya?ml|txt)$/i;
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".tools",
  ".vercel",
  ".codegraph",
  ".trigger",
  "_archive",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

function listGitTrackedFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\0")
      .filter((file) => file && TEXT_FILE_PATTERN.test(file));
  } catch {
    return null;
  }
}

function listTextFiles(directory = ".", prefix = "") {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) {
        files.push(...listTextFiles(join(directory, entry.name), join(prefix, entry.name)));
      }
      continue;
    }

    if (!entry.isFile()) continue;

    const file = join(prefix, entry.name);
    if (TEXT_FILE_PATTERN.test(file)) files.push(file);
  }

  return files;
}

const filesToScan = listGitTrackedFiles() ?? listTextFiles();

const corruptedFiles = filesToScan.filter((file) => {
  try {
    if (!statSync(file).isFile()) return false;
    return readFileSync(file).includes(0);
  } catch {
    return false;
  }
});

if (corruptedFiles.length > 0) {
  console.error(`NUL bytes found in:\n${corruptedFiles.map((file) => `  ${file}`).join("\n")}`);
  process.exit(1);
}

console.log(`check:nul OK - scanned ${filesToScan.length} text files`);
