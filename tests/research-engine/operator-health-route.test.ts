import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const operatorRoute = readFileSync("src/app/api/operator/research/health/route.ts", "utf8");
const publicRoute = readFileSync("src/app/api/health/research/route.ts", "utf8");

test("operator research health endpoint renders v_health as a red/green monitor surface", () => {
  assert.match(operatorRoute, /\brequireOperator\b/u, "operator health route must keep the existing operator auth guard");
  assert.match(operatorRoute, /\.schema\(["']research["']\)[\s\S]*\.from\(["']v_health["']\)/u, "health route must read research.v_health");
  assert.match(operatorRoute, /\bpaid_spend_without_ingest\b/u, "health checks must expose paid-spend-without-ingest");
  assert.match(operatorRoute, /\bapify_circuit\b/u, "health checks must expose the Apify circuit state");
  assert.match(operatorRoute, /\bdue_backlog\b/u, "health checks must expose backlog drain state");
  assert.match(operatorRoute, /\bblocked_jobs\b/u, "health checks must expose blocked work state");
  assert.match(operatorRoute, /\{\s*status:\s*healthy\s*\?\s*200\s*:\s*503\s*\}/u, "red research health must return HTTP 503");
});

test("public research health endpoint is monitorable without exposing operator controls", () => {
  assert.doesNotMatch(publicRoute, /\brequireOperator\b/u, "public health route must be callable by an external monitor");
  assert.match(publicRoute, /\bcreateSupabaseServiceClient\b/u, "public health route should read Supabase from the server side");
  assert.match(publicRoute, /\.schema\(["']research["']\)[\s\S]*\.from\(["']v_health["']\)/u, "public health route must read research.v_health");
  assert.match(publicRoute, /\bpaid_spend_without_ingest\b/u, "public health route must expose paid-spend failure as a red check");
  assert.match(publicRoute, /\{\s*status:\s*healthy\s*\?\s*200\s*:\s*503\s*\}/u, "public red research health must return HTTP 503");
});
