import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const captureBin = join(root, "hermes", "tools", "meta-library-capture", "bin", "capture.mjs");

function runCapture(args, { input } = {}) {
  return spawnSync(process.execPath, [captureBin, ...args], {
    input,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, HERMES_META_BROWSER_EXECUTABLE: process.env.HERMES_META_BROWSER_EXECUTABLE || "chromium" },
  });
}

test("CLI rejects unparseable JSON with exit code 3 and a stderr message", () => {
  const result = runCapture(["--input", "{this is not json"]);
  assert.equal(result.status, 3, `expected exit 3, got ${result.status}; stderr=${result.stderr}`);
  assert.equal(result.stdout.trim(), "", "stdout must stay empty on invalid input");
  assert.match(result.stderr, /invalid input/i, "stderr must explain the invalid input");
  assert.match(result.stderr, /could not parse JSON/i);
});

test("CLI rejects structurally invalid input with exit code 3 and names the field", () => {
  // Missing/invalid kind.
  const badKind = runCapture(["--input", JSON.stringify({ url: "https://example.com", kind: "nope" })]);
  assert.equal(badKind.status, 3);
  assert.match(badKind.stderr, /input\.kind/i);

  // resultsLimit over the 250 cap.
  const overLimit = runCapture([
    "--input",
    JSON.stringify({
      url: "https://example.com",
      kind: "page",
      resultsLimit: 9999,
    }),
  ]);
  assert.equal(overLimit.status, 3);
  assert.match(overLimit.stderr, /resultsLimit/i);

  // url must be http(s).
  const badUrl = runCapture(["--input", JSON.stringify({ url: "ftp://example.com", kind: "page" })]);
  assert.equal(badUrl.status, 3);
  assert.match(badUrl.stderr, /input\.url/i);
});

test("CLI with no input at all exits 3", () => {
  const result = runCapture([], { input: "" });
  assert.equal(result.status, 3, `expected exit 3, got ${result.status}; stderr=${result.stderr}`);
  assert.match(result.stderr, /no input provided/i);
  assert.equal(result.stdout.trim(), "");
});

test("CLI accepts valid input and emits exactly one MetaCaptureOutcome JSON on stdout", () => {
  // This actually runs the crawler against example.com; with no proxy and no
  // real ad_library_main responses it should resolve to a structured outcome
  // (FAILED / TIMED_OUT / trusted-zero — never a crash, never >1 JSON line).
  const result = runCapture([
    "--input",
    JSON.stringify({
      url: "https://example.com",
      kind: "page",
      metaPageId: "123",
      country: "AU",
      activeStatus: "active",
      resultsLimit: 10,
      timeoutMs: 8000,
    }),
  ]);

  const stdout = result.stdout.trim();
  assert.notEqual(stdout, "", "stdout must contain exactly one outcome JSON object");
  const lines = stdout.split("\n").filter((line) => line.trim());
  assert.equal(lines.length, 1, `stdout must be a single JSON line, got ${lines.length}`);

  const outcome = JSON.parse(lines[0]);
  assert.equal(outcome.provider, "hermes_browser");
  assert.ok(["SUCCEEDED", "FAILED", "TIMED_OUT"].includes(outcome.status), `unexpected status ${outcome.status}`);
  assert.equal(outcome.costUsd, 0);
  assert.equal(outcome.rawDatasetId, null);
  assert.equal(outcome.itemCount, outcome.items.length);
  assert.ok(outcome.runId, "outcome must carry a runId");
  assert.ok(typeof outcome.metadata.confirmed_absence === "boolean");
  assert.equal(typeof outcome.metadata.pages_loaded, "number");
  assert.equal(typeof outcome.metadata.scrolls, "number");

  // Exit code must agree with the status.
  if (outcome.status === "SUCCEEDED") assert.equal(result.status, 0);
  else assert.equal(result.status, 2);
});
