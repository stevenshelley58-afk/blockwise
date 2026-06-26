import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTemplateCloudBatches,
  buildWorkflowRunArgs,
  dispatchTemplateCloudBatches,
  parseCliArgs,
} from "../scripts/adstudio-dispatch-template-cloud-batches.mjs";

test("cloud template dispatcher slices all 330 candidates into max-50 batches", () => {
  const batches = buildTemplateCloudBatches({
    startIndex: 1,
    totalCount: 330,
    batchSize: 50,
    outputPrefix: "codex/adstudio-template-cloud-batch",
    maxParallel: 5,
  });

  assert.equal(batches.length, 7);
  assert.deepEqual(batches[0], {
    startIndex: 1,
    count: 50,
    endIndex: 50,
    outputBranch: "codex/adstudio-template-cloud-batch-001-050",
    maxParallel: 5,
  });
  assert.deepEqual(batches[6], {
    startIndex: 301,
    count: 30,
    endIndex: 330,
    outputBranch: "codex/adstudio-template-cloud-batch-301-330",
    maxParallel: 5,
  });
});

test("cloud template dispatcher builds workflow_dispatch arguments for each batch", () => {
  const batch = buildTemplateCloudBatches({
    startIndex: 94,
    totalCount: 5,
    batchSize: 5,
    outputPrefix: "codex/adstudio-template-cloud-batch",
    maxParallel: 3,
  })[0];

  assert.deepEqual(
    buildWorkflowRunArgs(
      {
        repo: "stevenshelley58-afk/blockwise",
        workflow: "adstudio-template-cloud-build.yml",
        targetRef: "feat/audit-intel-report",
      },
      batch,
    ),
    [
      "workflow",
      "run",
      "adstudio-template-cloud-build.yml",
      "--repo",
      "stevenshelley58-afk/blockwise",
      "--ref",
      "feat/audit-intel-report",
      "-f",
      "start_index=94",
      "-f",
      "count=5",
      "-f",
      "output_branch=codex/adstudio-template-cloud-batch-094-098",
      "-f",
      "max_parallel=3",
    ],
  );
});

test("cloud template dispatcher validates candidate and parallelism bounds", () => {
  assert.throws(
    () => buildTemplateCloudBatches({ startIndex: 329, totalCount: 3 }),
    /must not exceed 331/u,
  );
  assert.throws(() => buildTemplateCloudBatches({ batchSize: 51 }), /batchSize must be between 1 and 50/u);
  assert.throws(() => buildTemplateCloudBatches({ maxParallel: 21 }), /maxParallel must be between 1 and 20/u);
});

test("cloud template dispatcher dry-runs without calling gh", () => {
  const calls = [];
  const batches = dispatchTemplateCloudBatches(
    {
      repo: "stevenshelley58-afk/blockwise",
      workflow: "adstudio-template-cloud-build.yml",
      targetRef: "feat/audit-intel-report",
      startIndex: 1,
      totalCount: 2,
      batchSize: 1,
      outputPrefix: "codex/adstudio-template-cloud-batch",
      maxParallel: 1,
      dryRun: true,
    },
    (...args) => calls.push(args),
  );

  assert.equal(batches.length, 2);
  assert.deepEqual(calls, []);
});

test("cloud template dispatcher parses CLI options", () => {
  assert.deepEqual(
    parseCliArgs([
      "--repo",
      "owner/repo",
      "--target-ref",
      "feature",
      "--start-index",
      "101",
      "--total-count",
      "25",
      "--batch-size",
      "10",
      "--output-prefix",
      "codex/batch",
      "--max-parallel",
      "4",
      "--dry-run",
    ]),
    {
      repo: "owner/repo",
      workflow: "adstudio-template-cloud-build.yml",
      targetRef: "feature",
      startIndex: "101",
      totalCount: "25",
      batchSize: "10",
      outputPrefix: "codex/batch",
      maxParallel: "4",
      dryRun: true,
    },
  );
});
