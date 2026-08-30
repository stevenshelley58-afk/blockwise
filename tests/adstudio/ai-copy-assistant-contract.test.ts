import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("AI assistant is brief-first and generation never applies copy", () => {
  const source = readFileSync("src/components/adstudio/editor/ai-copy-assistant.tsx", "utf8");
  const formStart = source.indexOf("<form");
  const proposalStart = source.indexOf("{proposal ? (");

  assert.ok(formStart >= 0 && proposalStart > formStart, "the brief form must precede proposal review");
  assert.match(source, /id="ai-copy-brief"/);
  assert.match(source, /Generate suggestions/);
  assert.match(source, /Regenerate suggestions/);
  assert.doesNotMatch(source.match(/<form[\s\S]*?<\/form>/)?.[0] ?? "", /onApply\(/);
});

test("AI assistant supports per-field review, Use all, Use selected, failure recovery, and Brand Pack context", () => {
  const source = readFileSync("src/components/adstudio/editor/ai-copy-assistant.tsx", "utf8");

  assert.match(source, /Brand Pack ·/);
  assert.match(source, /Design text/);
  assert.match(source, /Facebook ad copy/);
  assert.match(source, /Use all/);
  assert.match(source, /Use selected \(\{selectedCount\}\)/);
  assert.match(source, /last complete suggestion is still available/);
  assert.match(source, /onImageCopySelectionKey/);
  assert.match(source, /metaCopySelectionKey/);
  assert.match(source, /<Checkbox/);
});
