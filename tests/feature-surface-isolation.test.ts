import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(file, "utf8");

test("disabled feature route mapping covers public and operator research surfaces", () => {
  const routes = read("src/lib/features/route-availability.ts");
  const middleware = read("src/middleware.ts");

  const featureRoutes = [
    "/ad-radar", "/property-check", "/suburb", "/audit", "/hero-lab", "/operator/research",
    "/api/operator/research",
    "/api/property-checks", "/api/research/ad-radar/suggestions", "/api/research/ads/search",
    "/api/research/advertisers/autocomplete", "/api/research/locations/autocomplete",
    "/api/research/locations/guess", "/api/research/swipe-file", "/api/research/audit/lead",
    "/api/research/audit/suggestions", "/api/research/local-ad-radar",
  ];
  for (const route of featureRoutes) {
    assert.match(routes, new RegExp(`prefix: "${route.replaceAll("/", "\\/")}"`));
  }
  for (const route of featureRoutes.filter((route) => route !== "/api/operator/research")) {
    assert.match(middleware, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(middleware, /\/api\/operator\/:path\*/);
  assert.match(middleware, /Cache-Control.*no-store/);
  assert.doesNotMatch(routes, /prefix: "\/api\/research"\s*,/);
});

test("disabled customer APIs gate before auth, client, or provider work", () => {
  const handlers = [
    ["src/app/api/property-checks/route.ts", 'featureDisabledResponse("propertyCheck")', "requireApiWorkspace("],
    ["src/app/api/property-checks/addresses/autocomplete/route.ts", 'featureDisabledResponse("propertyCheck")', "requireApiWorkspace("],
    ["src/app/api/research/ad-radar/suggestions/route.ts", 'featureDisabledResponse("adRadar")', "createSupabaseServiceClient()"],
    ["src/app/api/research/ads/search/route.ts", 'featureDisabledResponse("adRadar")', "requireApiWorkspace("],
    ["src/app/api/research/advertisers/autocomplete/route.ts", 'featureDisabledResponse("adRadar")', "requireApiWorkspace("],
    ["src/app/api/research/locations/autocomplete/route.ts", 'featureDisabledResponse("adRadar")', "createSupabaseServerClient()"],
    ["src/app/api/research/locations/guess/route.ts", 'featureDisabledResponse("adRadar")', "resolveAdRadarLocationGuess("],
    ["src/app/api/research/swipe-file/route.ts", 'featureDisabledResponse("adRadar")', "requireApiWorkspace("],
    ["src/app/api/research/audit/lead/route.ts", 'featureDisabledResponse("suburbPages")', "request.json()"],
    ["src/app/api/research/audit/suggestions/route.ts", 'featureDisabledResponse("suburbPages")', "createSupabaseServiceClient()"],
    ["src/app/api/research/local-ad-radar/route.ts", 'featureDisabledResponse("adRadar", "suburbPages")', "createSupabaseServiceClient()"],
  ] as const;

  for (const [file, gateText, clientText] of handlers) {
    const route = read(file);
    const gate = route.indexOf(gateText);
    const client = route.indexOf(clientText, gate + gateText.length);
    assert.ok(gate >= 0, `${file} needs its feature gate`);
    assert.ok(client >= 0, `${file} needs its guarded client/provider/auth work`);
    assert.ok(gate < client, `${file} must gate before ${clientText}`);
  }
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
  assert.doesNotMatch(progress, /useEffect|useState|setInterval|Running final checks/);
  assert.match(progress, /Creating your Feed and Story ads/);
});

test("operator research handlers share the pre-auth Ad Radar gate", () => {
  const operatorAuth = read("src/lib/operator/auth.ts");
  const apiFiles = [
    "src/app/api/operator/research/ads/[id]/display-state/route.ts",
    "src/app/api/operator/research/chat/route.ts",
    "src/app/api/operator/research/coverage/route.ts",
    "src/app/api/operator/research/defects/[id]/dismiss/route.ts",
    "src/app/api/operator/research/defects/[id]/investigate/route.ts",
    "src/app/api/operator/research/defects/route.ts",
    "src/app/api/operator/research/drain-status/route.ts",
    "src/app/api/operator/research/files/route.ts",
    "src/app/api/operator/research/health/route.ts",
    "src/app/api/operator/research/jobs/[id]/requeue/route.ts",
    "src/app/api/operator/research/jobs/[id]/route.ts",
    "src/app/api/operator/research/jobs/route.ts",
    "src/app/api/operator/research/kill-switch/route.ts",
    "src/app/api/operator/research/meta-api-validation/route.ts",
    "src/app/api/operator/research/policies/route.ts",
    "src/app/api/operator/research/refresh-now/route.ts",
    "src/app/api/operator/research/runs/[id]/raw/route.ts",
    "src/app/api/operator/research/runs/route.ts",
    "src/app/api/operator/research/skills/[slug]/route.ts",
    "src/app/api/operator/research/skills/route.ts",
  ];

  assert.match(operatorAuth, /adRadarDisabledResponse\(\)/);
  for (const file of apiFiles) {
    assert.match(read(file), /requireAdRadarOperator as requireOperator/);
  }
});
