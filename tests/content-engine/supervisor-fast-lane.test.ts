import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const supervisorSource = readFileSync(
  new URL("../../hermes/tools/research-runtime/bin/supabase-supervisor.mjs", import.meta.url),
  "utf8",
);

test("Hermes claims one interactive content run before maintenance planning", () => {
  const tickStart = supervisorSource.indexOf("async function tick()");
  const fastLane = supervisorSource.indexOf("jobTypes: [CONTENT_RUN_JOB_TYPE]", tickStart);
  const maintenance = supervisorSource.indexOf("buildRunId = await ensureBuildRun()", tickStart);

  assert.ok(tickStart >= 0, "tick function must exist");
  assert.ok(fastLane > tickStart, "content fast lane must exist inside tick");
  assert.ok(fastLane < maintenance, "content fast lane must run before maintenance planning");
  assert.match(supervisorSource, /p_job_types: jobTypes/u);
  assert.match(supervisorSource, /p_limit: limit/u);
});
