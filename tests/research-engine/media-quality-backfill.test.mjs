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
});
