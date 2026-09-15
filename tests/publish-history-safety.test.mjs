import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const base = "src/app/(customer)/ad-builder/publish-history/";
const source = readFileSync(base + "publish-history-flow.tsx", "utf8");

test("historical review retains all four original stages and parent combinations", () => {
  for (const text of ["1. Creative & copy", "2. Destination & form", "3. Audience, budget & schedule", "4. Review & create paused", "new_campaign_new_adset", "existing_campaign_new_adset", "existing_adset", "Creative variants"]) assert.ok(source.includes(text), text);
  assert.match(source, /aa3b081c53cdb9c331666ae184bdab4b333ef3b1/);
  assert.match(source, /Publish disabled in archive/);
  // The stage control is a quiet ghost button, not a CTA. It used to opt out
  // of the auto-injected arrow disc with `arrow={null}`; the disc is gone
  // system-wide, so the ghost variant is now the whole of that intent and no
  // call site passes an `arrow` prop at all.
  assert.match(source, /variant="ghost"/);
  assert.doesNotMatch(source, /arrow=\{/);
  assert.match(source, /whitespace-normal/);
  assert.doesNotMatch(source, /disabled=\{!stageCanContinue\}/);
});

test("archive client has no network, persistence, mutation or download capability", () => {
  for (const file of ["publish-history-flow.tsx", "archive-form.tsx", "publish-controls.ts"]) {
    const text = readFileSync(base + file, "utf8");
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const called = node.expression.getText(tree);
        assert.doesNotMatch(called, /fetch|axios|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|location\.(assign|replace)|document\.createElement/, file + ": " + called);
      }
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) assert.ok(!node.text.startsWith("/api/"), file + ": API path");
      ts.forEachChild(node, visit);
    }
    visit(tree);
    assert.doesNotMatch(text, /from ["']@\/components\/adbuilder\/instant-form-editor/);
  }
});

test("archive is authenticated, and the live publish route is restored behind the write gate", () => {
  const page = readFileSync(base + "page.tsx", "utf8");
  assert.match(page, /await requirePageSurfaceAccess\("adbuilder"\)/);
  assert.match(page, /Example data/);
  assert.match(page, /Publishing disabled/);

  // The live publish route renders the real flow again (it did from b752ec4af
  // until b626158a5 swapped in this archive "for testing"). It must never
  // hardcode the write decision: the gate requires the global switch AND a
  // per-workspace allowlist and fails closed, so a closed gate still creates
  // nothing in Meta.
  const current = readFileSync("src/app/(customer)/ad-builder/templates/[templateId]/publish/page.tsx", "utf8");
  assert.match(current, /import \{ PublishFlow \} from "\.\/publish-flow"/);
  assert.match(current, /metaPublishProviderWritesEnabled\(access\.workspaceId\)/);
  assert.doesNotMatch(current, /const providerWrites = false/);
  assert.match(current, /const automatedPublishAvailable = providerWrites && metaConnectionConnected/);
  // Without publishing defaults the flow can never enable its publish button,
  // so the restored route has to supply them.
  assert.match(current, /publishingDefaults=\{\{/);
  assert.match(current, /Preview only · nothing will be created/);
  // The read-only four-stage flow stays reachable for comparison.
  assert.match(current, /href="\/ad-builder\/publish-history"/);
});

test("historical catalogue distinguishes evidence and keeps the July mockup static", () => {
  const page = readFileSync(base + "page.tsx", "utf8");
  const julyMockup = readFileSync("public/publish-history/july-guided-mockup.html", "utf8");
  assert.match(page, /9<\/b> real implementations/);
  assert.match(page, /Design mockup, never live/);
  assert.match(page, /Proposal image, never live/);
  assert.match(page, /Genuine live implementation/);
  assert.match(page, /Closest to your brief/);
  assert.doesNotMatch(julyMockup, /fetch\s*\(/);
  assert.doesNotMatch(julyMockup, /XMLHttpRequest/);
  assert.doesNotMatch(julyMockup, /<form\b/i);
});
