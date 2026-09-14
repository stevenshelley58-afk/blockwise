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
  assert.match(source, /arrow=\{null\} variant="ghost"/);
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

test("archive is authenticated and the current flow links to it separately", () => {
  const page = readFileSync(base + "page.tsx", "utf8");
  assert.match(page, /await requirePageSurfaceAccess\("adstudio"\)/);
  assert.match(page, /Example data/);
  assert.match(page, /Publishing disabled/);
  const current = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/publish/page.tsx", "utf8");
  assert.match(current, /href="\/ad-studio\/publish-history" target="_blank" rel="noopener noreferrer"/);
});
