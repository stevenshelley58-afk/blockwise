import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../src/components/adstudio/instant-form-editor.tsx", import.meta.url), "utf8");

test("instant form editor preserves accessible authoring contracts", () => {
  assert.match(source, /role="status"[\s\S]*aria-live="polite"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /focus-visible:ring-2/);
  assert.match(source, /min-h-11/);
  assert.match(source, /flex flex-col gap-2 sm:flex-row/);
  assert.match(source, /body\.pinned === false/);
  assert.equal((source.match(/<label\b/g) ?? []).length, (source.match(/<\/label>/g) ?? []).length);
});
