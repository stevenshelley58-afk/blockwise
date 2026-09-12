import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("default entry keeps GET read-only and guards native scenes before legacy fallback", () => {
  const page=readFileSync("src/app/(customer)/ad-studio/ads/[id]/page.tsx","utf8");
  assert.ok(page.indexOf("readVueNativeEditor(ad.initialDocument)") < page.indexOf('editor !== "legacy"'));
  assert.ok(page.indexOf("if (nativeIdentity) redirect(") < page.indexOf('editor !== "legacy"'));
  assert.match(page,/workspaceId=\{access.workspaceId\} automatic/);
  assert.doesNotMatch(page,/copyAdToNativeTrial|method: "POST"/);
});
test("opening keeps the source and reuses the stable native identity", () => {
  const copy=readFileSync("src/lib/adstudio/vue-native-copy.ts","utf8");
  assert.match(copy,/sourceName.slice\(0, 160\)/);
  assert.doesNotMatch(copy,/sourceName.*native trial/);
  const host=readFileSync("src/components/adstudio/vue-editor/vue-editor-shell.tsx","utf8");
  assert.doesNotMatch(host,/Trial copy\.|Open original ad/);
});
