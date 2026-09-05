import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/adstudio/editor/editor-shell.tsx", "utf8");

test("AI generation stores a proposal without mutating editor copy", () => {
  const generateStart = source.indexOf("const proposeCopy = useCallback");
  const applyStart = source.indexOf("const useAllProposal = useCallback", generateStart);
  const generateBody = source.slice(generateStart, applyStart);

  assert.ok(generateStart >= 0 && applyStart > generateStart);
  assert.match(generateBody, /setProposal\(\{ onImage:/);
  assert.doesNotMatch(generateBody, /applyGeneratedCopy\(/);
  assert.match(source, /Nothing changes until you choose Use all or a field\./);
});

test("copy changes happen only through explicit field or apply-all actions", () => {
  const applyStart = source.indexOf("const useAllProposal = useCallback");
  const applyEnd = source.indexOf("const handlePublish = useCallback", applyStart);
  const applyBody = source.slice(applyStart, applyEnd);

  assert.match(applyBody, /applyGeneratedCopy\(proposal\.onImage, \{ \.\.\.state\.metaCopy, \.\.\.proposal\.copy \}\)/);
  assert.match(source, /onClick=\{onUseAll\}[^>]*>Use all/);
  assert.match(source, /onUse=\{\(\) => onUseText\(key, value\)\}/);
  assert.match(source, /onUse=\{\(\) => onUseMeta\(field, value\)\}/);
  assert.match(source, /function ProposalRow[\s\S]*onClick=\{onUse\}[^>]*>Use<\/button>/);
  assert.match(source, /onClick=\{onUseAll\} className="min-h-11/);
});
