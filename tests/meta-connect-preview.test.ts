import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file: string) => fs.readFileSync(file, "utf8");

test("Meta connection preview is guarded and uses the validated public Business ID", () => {
  const page = read("src/app/concept/meta-connect/page.tsx");
  const component = read("src/components/meta/meta-connect-preview.tsx");

  assert.match(page, /BLOCKWISE_META_CONNECT_PREVIEW/);
  assert.match(page, /notFound\(\)/);
  assert.match(page, /getMetaPartnerBusinessId/);
  assert.match(component, /Copy ID/);
  assert.match(component, /No accounts will be changed/);
  assert.match(component, /SIMULATED/);
  assert.doesNotMatch(component, /fetch\(/);
  assert.doesNotMatch(component, /localStorage/);
});

test("preview fixtures stay named and synthetic", () => {
  const config = read("src/config/niche/blockwise/meta-connect-preview.ts");
  const component = read("src/components/meta/meta-connect-preview.tsx");

  assert.match(config, /Harbour & Home/);
  assert.match(component, /Example assets/);
  assert.match(component, /Not selected/);
  assert.match(component, /Continue/);
});
