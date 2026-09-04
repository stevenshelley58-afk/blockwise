#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { auditTemplateArtifact } from "./audit.js";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const runDirOption = option(args, "--run-dir");
const iterationOption = option(args, "--iteration");
const artifactOption = option(args, "--artifact");
if (!artifactOption && !runDirOption) {
  console.error("Usage: ad-template-audit (--artifact artifact.json | --run-dir tool-run --iteration N) [--assets-dir dir] [--source source.png] [--out-dir dir]");
  process.exit(2);
}
if (artifactOption && runDirOption) {
  console.error("use either --artifact or --run-dir, not both");
  process.exit(2);
}
if (runDirOption && !iterationOption) {
  console.error("--iteration is required with --run-dir");
  process.exit(2);
}

const iteration = iterationOption === undefined || !/^\d+$/u.test(iterationOption) ? undefined : Number(iterationOption);
if (iterationOption !== undefined && (!Number.isSafeInteger(iteration) || iteration! < 0)) {
  console.error("--iteration must be a non-negative integer");
  process.exit(2);
}
const runDir = runDirOption ? resolve(runDirOption) : undefined;
const artifactPath = artifactOption
  ? resolve(artifactOption)
  : join(runDir!, "iterations", String(iteration).padStart(2, "0"), "artifact.json");
const assetsDir = resolve(option(args, "--assets-dir") ?? (runDir ?? resolve(artifactPath, "..")));
const sourceOption = option(args, "--source");
const sourcePath = sourceOption ? resolve(sourceOption) : runDir ? join(runDir, "previews", "source.png") : undefined;
const defaultOutDir = runDir
  ? join(runDir, "audit", String(iteration).padStart(2, "0"))
  : join(resolve(artifactPath, ".."), "audit");
const outDir = resolve(option(args, "--out-dir") ?? defaultOutDir);
const artifactBytes = await readFile(artifactPath);
let sourceBytes: Buffer | undefined;
if (sourcePath) {
  try {
    sourceBytes = await readFile(sourcePath);
  } catch (error) {
    if (sourceOption) throw error;
  }
}
const result = await auditTemplateArtifact({
  artifactBytes,
  assetsDir,
  ...(sourceBytes ? { sourceBytes } : {}),
  ...(runDir ? { runId: basename(runDir) } : {}),
  ...(iteration !== undefined ? { iteration } : {}),
});
await mkdir(outDir, { recursive: true });
if (result.outputs) {
  await writeFile(join(outDir, "feed.png"), result.outputs.feed);
  await writeFile(join(outDir, "story.png"), result.outputs.story);
}
const receiptPath = join(outDir, "receipt.json");
await writeFile(receiptPath, `${JSON.stringify(result.receipt, null, 2)}\n`);
console.log(JSON.stringify({ receiptPath, verdict: result.receipt.verdict }));
if (result.receipt.verdict === "fail") process.exitCode = 1;
