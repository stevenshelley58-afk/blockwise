import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AT_RISK_HOURS,
  classifyUrgency,
  hoursUnclaimed,
  URGENCY_LABELS,
} from "../src/lib/adbuilder/video-fulfilment.ts";

const code = (file: string) =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const NOW = new Date("2026-09-14T00:00:00Z");
const dueIn = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

test("an unclaimed order is surfaced as unclaimed whatever the clock says", () => {
  for (const hours of [48, 24, 6, -1]) {
    assert.equal(
      classifyUrgency({ fulfilmentState: "queued", firstDraftDueAt: dueIn(hours), claimedAt: null, now: NOW }),
      "unclaimed",
      `nothing owns this order with ${hours}h left`,
    );
  }
});

test("urgency escalates as the committed deadline approaches", () => {
  const claimed = NOW.toISOString();
  assert.equal(classifyUrgency({ fulfilmentState: "editing", firstDraftDueAt: dueIn(48), claimedAt: claimed, now: NOW }), "on_track");
  assert.equal(classifyUrgency({ fulfilmentState: "editing", firstDraftDueAt: dueIn(AT_RISK_HOURS * 2 - 1), claimedAt: claimed, now: NOW }), "due_soon");
  assert.equal(classifyUrgency({ fulfilmentState: "editing", firstDraftDueAt: dueIn(AT_RISK_HOURS), claimedAt: claimed, now: NOW }), "at_risk");
});

test("a passed deadline is overdue, not merely at risk", () => {
  assert.equal(
    classifyUrgency({ fulfilmentState: "editing", firstDraftDueAt: dueIn(-1), claimedAt: NOW.toISOString(), now: NOW }),
    "overdue",
  );
});

test("an order waiting on the customer stops asking for operator attention", () => {
  for (const state of ["draft_ready", "final_ready", "delivered", "needs_clarification"] as const) {
    assert.equal(
      classifyUrgency({ fulfilmentState: state, firstDraftDueAt: dueIn(-100), claimedAt: NOW.toISOString(), now: NOW }),
      "waiting_on_customer",
      `${state} is not the operator's move`,
    );
  }
});

test("every urgency has a label an operator can read", () => {
  for (const [key, label] of Object.entries(URGENCY_LABELS)) {
    assert.ok(label.length > 4, `${key} needs real copy`);
    assert.doesNotMatch(label, /_/, `${key} must not leak an internal state name`);
  }
});

test("time unclaimed is only reported while nobody owns the order", () => {
  assert.equal(hoursUnclaimed({ claimedAt: null, createdAt: NOW.toISOString(), now: NOW }), 0);
  assert.equal(hoursUnclaimed({ claimedAt: NOW.toISOString(), createdAt: "2026-09-13T00:00:00Z", now: NOW }), null);
  assert.equal(hoursUnclaimed({ claimedAt: null, createdAt: "2026-09-13T00:00:00Z", now: NOW }), 24);
});

test("claiming never writes the committed deadline", () => {
  const source = code("src/lib/adbuilder/video-fulfilment-actions.ts");
  const claim = source.slice(source.indexOf("export async function claimOrder"), source.indexOf("export async function publishDraft"));
  assert.doesNotMatch(claim, /first_draft_due_at/, "a claim must not touch the promise made to the customer");
  assert.match(claim, /\.is\("assigned_operator", null\)/, "only an unclaimed order can be claimed");
});

test("only a paid order can be claimed, drafted or delivered", () => {
  const source = code("src/lib/adbuilder/video-fulfilment-actions.ts");
  const paidChecks = source.match(/payment_state !== "paid"/g) ?? [];
  assert.ok(paidChecks.length >= 3, `claim, draft and deliver must each require payment, found ${paidChecks.length}`);
});

test("a delivery cannot happen twice", () => {
  const source = code("src/lib/adbuilder/video-fulfilment-actions.ts");
  const deliver = source.slice(source.indexOf("export async function deliverFinal"));
  assert.match(deliver, /already \$\{order\.fulfilment_state\}|\$\{order\.fulfilment_state\}/, "a finished order is refused");
  assert.match(deliver, /\.not\("fulfilment_state", "in", "\(delivered,cancelled\)"\)/, "the update is guarded, not just the read");
});

test("a draft or final must be a ready asset on the same order", () => {
  const source = code("src/lib/adbuilder/video-fulfilment-actions.ts");
  const material = source.match(/upload_state !== "ready"/g) ?? [];
  assert.equal(material.length, 2, "both the draft and the final are checked");
  const scoping = source.match(/\.eq\("project_id", projectId\)/g) ?? [];
  assert.ok(scoping.length >= 2, "the asset must belong to the order's project");
});

test("operator actions are recorded on the append-only trail", () => {
  const source = code("src/lib/adbuilder/video-fulfilment-actions.ts");
  assert.match(source, /video_order_events/);
  assert.match(source, /actor_role: "operator"/);
  assert.match(source, /idempotency_key/);
  // A duplicate key is a retry, not a failure.
  assert.match(source, /error\.code !== "23505"/);
});

test("the queue shows paid orders ordered by the commitment already made", () => {
  const source = code("src/lib/adbuilder/video-fulfilment.ts");
  assert.match(source, /\.eq\("payment_state", "paid"\)/, "unpaid work must not appear as work");
  assert.match(source, /order\("first_draft_due_at"/);
});

test("production material is never handed to the customer-facing pack", () => {
  const source = code("src/lib/adbuilder/video-fulfilment.ts");
  const pack = source.slice(source.indexOf("export async function loadSourcePack"));
  assert.match(pack, /\["source_upload", "source_workspace"\]/);
  assert.doesNotMatch(pack, /production_source/);
});
