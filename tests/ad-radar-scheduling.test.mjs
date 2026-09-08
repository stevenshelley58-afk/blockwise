import test from "node:test";
import assert from "node:assert/strict";
import { chunkIds, selectDueAdRadarPages } from "../hermes/tools/research-runtime/bin/ad-radar-scheduling.mjs";

const NOW = new Date("2026-09-08T00:00:00.000Z");
const ago = (hours) => new Date(NOW.getTime() - hours * 3600000).toISOString();
const future = (hours) => new Date(NOW.getTime() + hours * 3600000).toISOString();
const page = (id, overrides = {}) => ({ id, page_id: String(1000 + Number(id)), scan_enabled: true, status: "resolved_collectable", scan_state: "healthy", initial_fill_completed_at: ago(48), next_scan_at: ago(1), ...overrides });
const scope = (customer = [], wa = []) => ({ isInterested: (row) => customer.includes(row.id), isWaOwned: (row) => wa.includes(row.id) });
const ids = (rows) => rows.map((row) => row.id);

test("selects due WA-owned resolved pages", () => assert.deepEqual(ids(selectDueAdRadarPages([page("1")], scope([], ["1"]), NOW)), ["1"]));
test("excludes non-WA keyword metadata", () => assert.deepEqual(ids(selectDueAdRadarPages([page("1")], scope(), NOW)), []));
test("allows explicit customer page without agent ownership", () => assert.deepEqual(ids(selectDueAdRadarPages([page("1", { status: "candidate" })], scope(["1"]), NOW)), ["1"]));
test("requires numeric page ids", () => assert.deepEqual(ids(selectDueAdRadarPages([page("1", { page_id: "slug:romance" })], scope(["1"]), NOW)), []));
test("future failure backoff always blocks customer pages", () => assert.deepEqual(ids(selectDueAdRadarPages([page("1", { next_scan_at: future(100), backoff_until: future(2) })], scope(["1"]), NOW)), []));
test("fresh customer completion does not churn before 24 hours", () => assert.deepEqual(ids(selectDueAdRadarPages([page("1", { next_scan_at: future(720), last_scan_completed_at: ago(2) })], scope(["1"]), NOW)), []));
test("customer wake resumes after 24 hours", () => assert.deepEqual(ids(selectDueAdRadarPages([page("1", { next_scan_at: future(720), last_scan_completed_at: ago(24) })], scope(["1"]), NOW)), ["1"]));
test("never-completed customer page wakes immediately", () => assert.deepEqual(ids(selectDueAdRadarPages([page("1", { next_scan_at: future(720), last_scan_completed_at: null })], scope(["1"]), NOW)), ["1"]));
test("active queue membership excludes a due page", () => assert.deepEqual(ids(selectDueAdRadarPages([page("1")], scope([], ["1"]), NOW, 3, new Set(["1"]))), []));
test("first-fill shares capacity with a customer refresh", () => assert.deepEqual(ids(selectDueAdRadarPages([page("a", { page_id: "2001" }), page("b", { page_id: "2002", scan_state: "needs_first_fill", initial_fill_completed_at: null })], scope(["a"], ["a", "b"]), NOW, 2)), ["a", "b"]));
test("first-fill uses scan truth rather than has_ever_run_ads", () => assert.deepEqual(ids(selectDueAdRadarPages([page("1", { has_ever_run_ads: false, scan_state: "healthy", initial_fill_completed_at: ago(1) })], scope([], ["1"]), NOW)), ["1"]));
test("chunks identities at fifty", () => { const chunks = chunkIds(Array.from({ length: 121 }, (_, i) => String(i))); assert.deepEqual(chunks.map((part) => part.length), [50, 50, 21]); });
test("deduplicates identity chunks", () => assert.deepEqual(chunkIds(["a", "a", "b"]), [["a", "b"]]));test("disabled customer page is excluded", () => assert.deepEqual(ids(selectDueAdRadarPages([page("1", { scan_enabled: false })], scope(["1"]), NOW)), []));