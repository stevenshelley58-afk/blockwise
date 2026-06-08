import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TEXT_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|json|md|mdx|html|svg|ya?ml|txt)$/i;

const trackedFiles = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((file) => file && TEXT_FILE_PATTERN.test(file));

const corruptedFiles = trackedFiles.filter((file) => {
  try {
    return readFileSync(file).includes(0);
  } catch {
    return false;
  }
});

if (corruptedFiles.length > 0) {
  console.error(`NUL bytes found in:\n${corruptedFiles.map((file) => `  ${file}`).join("\n")}`);
  process.exit(1);
}

console.log(`check:nul OK - scanned ${trackedFiles.length} tracked text files`);
