import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const scriptPath = "hermes/tools/research-runtime/bin/media-quality-backfill.mjs";

test("media quality backfill inspects all captured images and rebuilds affected creatives", () => {
  assert.equal(existsSync(scriptPath), true, "media quality backfill must exist");
  const source = readFileSync(scriptPath, "utf8");

  assert.match(source, /capture_status=eq\.captured[\s\S]*kind=eq\.image/iu);
  assert.match(source, /readImageDimensions[\s\S]*assessCapturedImageQuality/iu);
  assert.match(source, /capture_status\s*=\s*["']blocked["']/u);
  assert.match(source, /refreshCreativeStoredMedia/iu);
  assert.match(source, /--dry-run/iu);
  assert.match(source, /AbortSignal\.timeout\(fetchTimeoutMs\)/u);
  assert.match(source, /mapWithConcurrency\(assets, concurrency/iu);
  assert.match(source, /progress[\s\S]*stats\.scanned/u);
  assert.doesNotMatch(source, /last_error\s*=/u, "the live media_assets table has no last_error column");
});
