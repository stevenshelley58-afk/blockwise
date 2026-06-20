import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const operatorRoute = readFileSync("src/app/api/operator/research/health/route.ts", "utf8");
const publicRoute = readFileSync("src/app/api/health/research/route.ts", "utf8");
const healthLoader = readFileSync("src/lib/research/health.ts", "utf8");

test("operator research health endpoint renders bounded health checks as a red/green monitor surface", () => {
  assert.match(operatorRoute, /\brequireOperator\b/u, "operator health route must keep the existing operator auth guard");
  assert.match(operatorRoute, /\bloadResearchHealth\b/u, "operator health route must use the bounded health loader");
  assert.doesNotMatch(operatorRoute, /\.from\(["']v_health["']\)/u, "operator health route must not read the slow research.v_health view");
  assert.match(healthLoader, /\bpaid_spend_without_ingest\b/u, "health checks must expose paid-spend-without-ingest");
  assert.match(healthLoader, /\bapify_circuit\b/u, "health checks must expose the Apify circuit state");
  assert.match(healthLoader, /\bdue_backlog\b/u, "health checks must expose backlog drain state");
  assert.match(healthLoader, /\bblocked_jobs\b/u, "health checks must expose blocked work state");
  assert.match(operatorRoute, /\{\s*status:\s*healthy\s*\?\s*200\s*:\s*503\s*\}/u, "red research health must return HTTP 503");
});

test("public research health endpoint is monitorable without exposing operator controls", () => {
  assert.doesNotMatch(publicRoute, /\brequireOperator\b/u, "public health route must be callable by an external monitor");
  assert.match(publicRoute, /\bcreateSupabaseServiceClient\b/u, "public health route should read Supabase from the server side");
  assert.match(publicRoute, /\bloadResearchHealth\b/u, "public health route must use the bounded health loader");
  assert.doesNotMatch(publicRoute, /\.from\(["']v_health["']\)/u, "public health route must not read the slow research.v_health view");
  assert.match(healthLoader, /\bpaid_spend_without_ingest\b/u, "public health route must expose paid-spend failure as a red check");
  assert.match(publicRoute, /\{\s*status:\s*healthy\s*\?\s*200\s*:\s*503\s*\}/u, "public red research health must return HTTP 503");
});

test("research health loader uses bounded/indexed table queries", () => {
  assert.doesNotMatch(healthLoader, /\.from\(["']v_health["']\)/u, "health loader must not depend on research.v_health");
  assert.match(healthLoader, /DUE_BACKLOG_THRESHOLD \+ 1/u, "due backlog query must cap rows at the red threshold");
  assert.match(healthLoader, /BLOCKED_JOB_THRESHOLD \+ 1/u, "blocked job query must cap rows at the red threshold");
  assert.match(healthLoader, /PAID_RUN_SAMPLE_LIMIT/u, "paid spend check must use a bounded activity sample");
  assert.match(healthLoader, /\.eq\(["']queue_name["'], ["']research["']\)/u, "work queue health queries must stay on the research queue");
});
