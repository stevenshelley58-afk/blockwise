#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_TOTAL = 330;
const DEFAULT_WORKFLOW = "adstudio-template-cloud-build.yml";
const DEFAULT_OUTPUT_PREFIX = "codex/adstudio-template-cloud-batch";

function parseInteger(value, name) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || String(value).trim() === "") {
    throw new Error(`${name} must be an integer`);
  }
  return parsed;
}

function padCandidate(number) {
  return String(number).padStart(3, "0");
}

export function buildTemplateCloudBatches(input = {}) {
  const startIndex = parseInteger(input.startIndex ?? 1, "startIndex");
  const totalCount = parseInteger(input.totalCount ?? DEFAULT_TOTAL, "totalCount");
  const batchSize = parseInteger(input.batchSize ?? 50, "batchSize");
  const maxParallel = parseInteger(input.maxParallel ?? 5, "maxParallel");
  const outputPrefix = String(input.outputPrefix ?? DEFAULT_OUTPUT_PREFIX).trim();

  if (startIndex < 1 || startIndex > DEFAULT_TOTAL) {
    throw new Error(`startIndex must be between 1 and ${DEFAULT_TOTAL}`);
  }
  if (totalCount < 1) {
    throw new Error("totalCount must be at least 1");
  }
  if (startIndex + totalCount - 1 > DEFAULT_TOTAL) {
    throw new Error(`startIndex + totalCount must not exceed ${DEFAULT_TOTAL + 1}`);
  }
  if (batchSize < 1 || batchSize > 50) {
    throw new Error("batchSize must be between 1 and 50");
  }
  if (maxParallel < 1 || maxParallel > 20) {
    throw new Error("maxParallel must be between 1 and 20");
  }
  if (!outputPrefix) {
    throw new Error("outputPrefix is required");
  }

  const batches = [];
  let nextStart = startIndex;
  const finalIndex = startIndex + totalCount - 1;

  while (nextStart <= finalIndex) {
    const nextEnd = Math.min(nextStart + batchSize - 1, finalIndex);
    batches.push({
      startIndex: nextStart,
      count: nextEnd - nextStart + 1,
      endIndex: nextEnd,
      outputBranch: `${outputPrefix}-${padCandidate(nextStart)}-${padCandidate(nextEnd)}`,
      maxParallel,
    });
    nextStart = nextEnd + 1;
  }

  return batches;
}

export function buildWorkflowRunArgs(options, batch) {
  const workflow = String(options.workflow ?? DEFAULT_WORKFLOW).trim();
  const targetRef = String(options.targetRef ?? "").trim();
  const repo = String(options.repo ?? "").trim();
  const codexModel = String(options.codexModel ?? "").trim();

  if (!workflow) throw new Error("workflow is required");
  if (!targetRef) throw new Error("targetRef is required");
  if (!repo) throw new Error("repo is required");

  const args = [
    "workflow",
    "run",
    workflow,
    "--repo",
    repo,
    "--ref",
    targetRef,
    "-f",
    `start_index=${batch.startIndex}`,
    "-f",
    `count=${batch.count}`,
    "-f",
    `output_branch=${batch.outputBranch}`,
    "-f",
    `max_parallel=${batch.maxParallel}`,
  ];
  if (codexModel) {
    args.push("-f", `codex_model=${codexModel}`);
  }

  return args;
}

export function parseCliArgs(argv) {
  const options = {
    repo: process.env.GITHUB_REPOSITORY ?? "",
    workflow: DEFAULT_WORKFLOW,
    targetRef: process.env.TARGET_REF ?? process.env.GITHUB_REF_NAME ?? "",
    startIndex: process.env.START_INDEX ?? 1,
    totalCount: process.env.TOTAL_COUNT ?? DEFAULT_TOTAL,
    batchSize: process.env.BATCH_SIZE ?? 50,
    outputPrefix: process.env.OUTPUT_PREFIX ?? DEFAULT_OUTPUT_PREFIX,
    maxParallel: process.env.MAX_PARALLEL ?? 5,
    codexModel: process.env.CODEX_MODEL ?? "",
    dryRun: process.env.DRY_RUN === "true",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return value;
    };

    switch (arg) {
      case "--repo":
        options.repo = readValue();
        break;
      case "--workflow":
        options.workflow = readValue();
        break;
      case "--target-ref":
        options.targetRef = readValue();
        break;
      case "--start-index":
        options.startIndex = readValue();
        break;
      case "--total-count":
        options.totalCount = readValue();
        break;
      case "--batch-size":
        options.batchSize = readValue();
        break;
      case "--output-prefix":
        options.outputPrefix = readValue();
        break;
      case "--max-parallel":
        options.maxParallel = readValue();
        break;
      case "--codex-model":
        options.codexModel = readValue();
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function dispatchTemplateCloudBatches(options, runner = execFileSync) {
  const batches = buildTemplateCloudBatches(options);
  const commands = batches.map((batch) => buildWorkflowRunArgs(options, batch));

  for (const args of commands) {
    console.log(`gh ${args.join(" ")}`);
    if (!options.dryRun) {
      runner("gh", args, { stdio: "inherit" });
    }
  }

  return batches;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  const batches = dispatchTemplateCloudBatches(options);
  const mode = options.dryRun ? "Prepared" : "Dispatched";
  console.log(`${mode} ${batches.length} cloud template batch${batches.length === 1 ? "" : "es"}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
