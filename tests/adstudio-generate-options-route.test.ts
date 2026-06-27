import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = () => readFileSync("src/app/api/adstudio/generate-options/route.ts", "utf8");

test("generate-options route uses the operator image_generative profile", () => {
  const source = routeSource();
  assert.match(source, /resolveRuntimeModelProfile\("image_generative"\)/);
  // it must NOT silently reuse the fit/composite profile
  assert.doesNotMatch(source, /resolveRuntimeModelProfile\("image_final"\)/);
});

test("generate-options route is auth-gated and rate-limited on its own bucket", () => {
  const source = routeSource();
  assert.match(source, /requireAdStudioRequest\(request\)/);
  assert.match(source, /bucket: "ai-generate-options"/);
});

test("generate-options grounds on the user's resolved photo and re-checks compliance", () => {
  const source = routeSource();
  assert.match(source, /resolveAdStudioImageForModel\(/);
  assert.match(source, /requiresReferenceAssets: referenceAssets\.length > 0/);
  assert.match(source, /generateCreativeOptions\(\{/);
  assert.match(source, /compliance:/);
});

test("generate-options records a traceable provider run", () => {
  const source = routeSource();
  assert.match(source, /recordAdStudioProviderRun\(/);
  assert.match(source, /modelProfile: "image_generative"/);
});
