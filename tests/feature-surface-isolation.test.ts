import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(file, "utf8");

test("disabled feature route mapping covers public and operator research surfaces", () => {
  const routes = read("src/lib/features/route-availability.ts");
  const middleware = read("src/middleware.ts");

  for (const route of ["/ad-radar", "/property-check", "/suburb", "/audit", "/hero-lab", "/operator/research"]) {
    assert.match(routes, new RegExp(`prefix: "${route.replaceAll("/", "\\/")}"`));
    assert.match(middleware, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(middleware, /Cache-Control.*no-store/);
});

test("local ad radar is feature-gated before its service client is created", () => {
  const route = read("src/app/api/research/local-ad-radar/route.ts");
  const gate = route.indexOf('featureDisabledResponse("adRadar", "suburbPages")');
  const client = route.indexOf("createSupabaseServiceClient()");

  assert.ok(gate >= 0);
  assert.ok(client >= 0);
  assert.ok(gate < client);
});

test("active navigation excludes disabled features rather than hiding hardcoded routes", () => {
  const navigation = read("src/components/sidebar-nav.tsx");
  const mobile = read("src/components/app/mobile-bottom-nav.tsx");

  assert.match(navigation, /feature: "adRadar"/);
  assert.match(navigation, /feature: "propertyCheck"/);
  assert.match(navigation, /!item\.feature \|\| niche\.features\[item\.feature\]/);
  assert.doesNotMatch(mobile, /self_serve:\s*\[[^\]]*\/ad-radar/);
  assert.match(mobile, /niche\.nav\.mobileTabs/);
});

test("active Ad Studio generation has no local Ad Radar dependency", () => {
  const dialog = read("src/components/adstudio/new-ad-dialog.tsx");
  const progress = read("src/components/adstudio/generation-progress.tsx");

  assert.match(dialog, /GenerationProgress/);
  assert.doesNotMatch(dialog, /GenerationAdStream|preloadGenerationAdStream|generationAdLocation|local-ad-radar/);
  assert.doesNotMatch(progress, /fetch\(|local-ad-radar|ad-radar/);
});

test("operator research handlers share the pre-auth Ad Radar gate", () => {
  const operatorAuth = read("src/lib/operator/auth.ts");
  const apiFiles = [
    "src/app/api/operator/research/jobs/route.ts",
    "src/app/api/operator/research/refresh-now/route.ts",
    "src/app/api/operator/research/defects/[id]/investigate/route.ts",
  ];

  assert.match(operatorAuth, /adRadarDisabledResponse\(\)/);
  for (const file of apiFiles) {
    assert.match(read(file), /requireAdRadarOperator as requireOperator/);
  }
});
