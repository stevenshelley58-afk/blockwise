import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const base = "src/app/(customer)/ad-studio/publish-history/";
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
    assert.doesNotMatch(text, /from ["']@\/components\/adstudio\/instant-form-editor/);
  }
});

test("archive is authenticated and the current publish route uses it as a safe test flow", () => {
  const page = readFileSync(base + "page.tsx", "utf8");
  assert.match(page, /await requirePageSurfaceAccess\("adstudio"\)/);
  assert.match(page, /Example data/);
  assert.match(page, /Publishing disabled/);
  const current = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/publish/page.tsx", "utf8");
  assert.match(current, /publish-history\/publish-history-flow/);
  assert.match(current, /const providerWrites = false/);
  assert.match(current, /Test flow · nothing will be created/);
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
