import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyMetaAdLibraryPayload } from "../hermes/tools/research-runtime/bin/meta-ad-library-parser.mjs";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "meta-ad-library");
const fixture = (name) => readFileSync(join(fixturesDir, name), "utf8");

test("normal positive results classify as success with structured ads", () => {
  const result = classifyMetaAdLibraryPayload(fixture("positive-plain.json"));
  assert.equal(result.outcome, "success");
  assert.deepEqual(result.adIds, ["391219454073578_101", "391219454073578_102", "391219454073578_103"]);
  assert.equal(result.connectionCount, 3);
  assert.equal(result.pageInfo.hasNextPage, false);
  assert.equal(result.pageInfo.endCursor, "AQHR9c7.example-cursor");
});

test("escaped positive results parse identically to plain payloads", () => {
  const result = classifyMetaAdLibraryPayload(fixture("positive-escaped.json"));
  assert.equal(result.outcome, "success");
  assert.deepEqual(result.adIds, ["891243346185243_201", "891243346185243_202"]);
  assert.equal(result.pageInfo.hasNextPage, false);
  assert.equal(result.pageInfo.endCursor, "CUR.escaped-1");
});

test("reordered connection fields still classify as success", () => {
  const result = classifyMetaAdLibraryPayload(fixture("positive-reordered-fields.json"));
  assert.equal(result.outcome, "success");
  assert.deepEqual(result.adIds, ["678085702054671_301", "678085702054671_302"]);
  assert.equal(result.connectionCount, 2);
  assert.equal(result.pageInfo.hasNextPage, false);
});

test("confirmed absence requires count=0, empty edges, and no next page", () => {
  const result = classifyMetaAdLibraryPayload(fixture("zero-confirmed.json"));
  assert.equal(result.outcome, "confirmed_absence");
  assert.equal(result.connectionCount, 0);
  assert.equal(result.pageInfo.hasNextPage, false);
});

test("pagination evidence is surfaced, not inferred", () => {
  const result = classifyMetaAdLibraryPayload(fixture("paginated-results.json"));
  assert.equal(result.outcome, "success");
  assert.equal(result.adIds.length, 3);
  assert.equal(result.connectionCount, 500);
  assert.equal(result.pageInfo.hasNextPage, true);
  assert.equal(result.pageInfo.endCursor, "CUR.next-page-403");
});

test("challenge/captcha is a failure outcome, never zero ads", () => {
  const result = classifyMetaAdLibraryPayload(fixture("challenge-captcha.json"));
  assert.equal(result.outcome, "challenge");
  assert.equal(result.adIds.length, 0);
});

test("login wall is a failure outcome, never zero ads", () => {
  const result = classifyMetaAdLibraryPayload(fixture("login-wall.json"));
  assert.equal(result.outcome, "login_wall");
  assert.equal(result.adIds.length, 0);
});

test("HTTP 200 shell without a connection payload is unparseable", () => {
  const result = classifyMetaAdLibraryPayload(fixture("unparseable-200.json"));
  assert.equal(result.outcome, "unparseable");
});

test("empty input is unparseable, not absence", () => {
  const result = classifyMetaAdLibraryPayload("");
  assert.equal(result.outcome, "unparseable");
});

test("parser is deterministic across repeated runs", () => {
  const first = classifyMetaAdLibraryPayload(fixture("positive-plain.json"));
  const second = classifyMetaAdLibraryPayload(fixture("positive-plain.json"));
  assert.deepEqual(first, second);
});
