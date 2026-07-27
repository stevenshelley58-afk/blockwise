import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/suburb/[postcode]/report-client.tsx", "utf8");

test("suburb report video creatives render their stored media URL", () => {
  assert.match(
    source,
    /<video\s+src=\{media\.url\}[\s\S]*\bcontrols\b[\s\S]*\bplaysInline\b[\s\S]*preload="metadata"/u,
  );
  assert.doesNotMatch(
    source,
    /media\.kind === "video"\s*\?\s*<video(?![^>]*\bsrc=)/u,
  );
});
