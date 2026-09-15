import assert from "node:assert/strict";
import test from "node:test";
import { canTransition, isMutable } from "../src/lib/adbuilder/video-upload-ledger.ts";
import {
  assessBriefCompleteness,
  BRIEF_ISSUE_MESSAGES,
  computeReadyAt,
  type BriefInput,
} from "../src/lib/adbuilder/video-types.ts";

test("the upload ledger only advances in the documented direction", () => {
  assert.equal(canTransition("initiated", "uploaded"), true);
  assert.equal(canTransition("uploaded", "validating"), true);
  assert.equal(canTransition("validating", "ready"), true);
  assert.equal(canTransition("validating", "rejected"), true);
  assert.equal(canTransition("initiated", "rejected"), true);
});

test("the upload ledger never moves backwards or skips validation", () => {
  assert.equal(canTransition("uploaded", "initiated"), false);
  assert.equal(canTransition("validating", "uploaded"), false);
  assert.equal(canTransition("initiated", "ready"), false, "bytes must not be trusted before inspection");
  assert.equal(canTransition("uploaded", "ready"), false, "bytes must not be trusted before inspection");
});

test("ready and rejected are terminal, so a retry cannot overwrite a valid asset", () => {
  for (const to of ["initiated", "uploaded", "validating", "ready", "rejected"] as const) {
    assert.equal(canTransition("ready", to), false, `ready must not move to ${to}`);
    assert.equal(canTransition("rejected", to), false, `rejected must not move to ${to}`);
  }
  assert.equal(isMutable("ready"), false);
  assert.equal(isMutable("rejected"), false);
  assert.equal(isMutable("validating"), true);
});

const completeBrief: BriefInput = {
  objective: "Get more appraisal enquiries",
  audience: "Homeowners in Bondi",
  desiredAction: "Book a call",
  keyFacts: "18 years local, 240 sales",
  overlayWording: "Free appraisal this week",
  wantsWordingHelp: false,
  uploadPermissionConfirmed: true,
  assetCount: 3,
};

test("a complete brief reports no issues", () => {
  assert.deepEqual(assessBriefCompleteness(completeBrief), []);
});

test("asking us to write the overlay wording satisfies the overlay requirement", () => {
  const issues = assessBriefCompleteness({
    ...completeBrief,
    overlayWording: null,
    wantsWordingHelp: true,
  });
  assert.deepEqual(issues, []);
});

test("a brief missing overlay wording and not asking for help is incomplete", () => {
  const issues = assessBriefCompleteness({ ...completeBrief, overlayWording: "  " });
  assert.deepEqual(issues, ["overlay_wording_missing"]);
});

test("permission must be explicitly confirmed before checkout", () => {
  const issues = assessBriefCompleteness({ ...completeBrief, uploadPermissionConfirmed: false });
  assert.deepEqual(issues, ["permission_not_confirmed"]);
});

test("a brief with no assets cannot be paid for", () => {
  const issues = assessBriefCompleteness({ ...completeBrief, assetCount: 0 });
  assert.deepEqual(issues, ["no_assets"]);
});

test("whitespace alone does not satisfy a required field", () => {
  const issues = assessBriefCompleteness({ ...completeBrief, objective: "   ", keyFacts: "\n\t" });
  assert.deepEqual(issues, ["objective_missing", "key_facts_missing"]);
});

test("every completeness issue has customer-facing wording", () => {
  for (const [issue, message] of Object.entries(BRIEF_ISSUE_MESSAGES)) {
    assert.ok(message.length > 10, `${issue} needs real copy, got: ${message}`);
  }
});

test("readiness is the later of payment and a complete brief", () => {
  const paid = new Date("2026-09-14T01:00:00Z");
  const complete = new Date("2026-09-14T03:00:00Z");
  assert.equal(computeReadyAt({ paidAt: paid, briefCompleteAt: complete }).toISOString(), complete.toISOString());
  // A brief completed before payment does not start the clock early.
  assert.equal(computeReadyAt({ paidAt: complete, briefCompleteAt: paid }).toISOString(), complete.toISOString());
});
