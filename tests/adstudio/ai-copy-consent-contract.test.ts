import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/adstudio/editor/editor-shell.tsx", "utf8");

test("AI generation stores a proposal without mutating editor copy", () => {
  const generateStart = source.indexOf("const proposeCopy = useCallback");
  const applyStart = source.indexOf("const applyProposal = useCallback", generateStart);
  const generateBody = source.slice(generateStart, applyStart);

  assert.ok(generateStart >= 0 && applyStart > generateStart);
  assert.match(generateBody, /setProposal\(\{ onImage:/);
  assert.doesNotMatch(generateBody, /applyGeneratedCopy\(/);
  assert.match(source, /Nothing changes until you apply it\./);
});

test("copy changes happen only through explicit field or apply-all actions", () => {
  const applyStart = source.indexOf("const applyProposal = useCallback");
  const applyEnd = source.indexOf("const handlePublish = useCallback", applyStart);
  const applyBody = source.slice(applyStart, applyEnd);

  assert.match(applyBody, /if \(field\)/);
  assert.match(applyBody, /applyGeneratedCopy\(\{\}, \{ \.\.\.state\.metaCopy, \[field\]: value \}\)/);
  assert.match(applyBody, /applyGeneratedCopy\(proposal\.onImage, \{ \.\.\.state\.metaCopy, \.\.\.proposal\.copy \}\)/);
  assert.match(source, /onClick=\{\(\) => applyProposal\(field\)\}/);
  assert.match(source, /onClick=\{\(\) => applyProposal\(\)\}/);
  assert.match(source, /className="min-h-11[^\"]*" onClick=\{\(\) => applyProposal\(field\)\}/);
  assert.match(source, /className="mt-3 min-h-11[^\"]*" onClick=\{\(\) => applyProposal\(\)\}>Apply all/);
});
