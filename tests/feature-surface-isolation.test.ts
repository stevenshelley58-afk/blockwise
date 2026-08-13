import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(file, "utf8");

test("disabled feature route mapping covers public research surfaces", () => {
  const routes = read("src/lib/features/route-availability.ts");
  const middleware = read("src/proxy.ts");

  const featureRoutes = [
    "/ad-radar", "/property-check", "/suburb", "/audit", "/hero-lab",
    "/api/property-checks", "/api/research/ad-radar/suggestions", "/api/research/ads/search",
    "/api/research/advertisers/autocomplete", "/api/research/locations/autocomplete",
    "/api/research/locations/guess", "/api/research/swipe-file", "/api/research/audit/lead",
    "/api/research/audit/suggestions", "/api/research/local-ad-radar",
  ];
  for (const route of featureRoutes) {
    assert.match(routes, new RegExp(`prefix: "${route.replaceAll("/", "\\/")}"`));
  }
  assert.match(middleware, /isFeatureRouteAvailable\(pathname, niche\.features\)/);
  assert.match(middleware, /matcher:/);
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
  const nicheNavigation = read("src/config/niche/blockwise.ts");
  const mobile = read("src/components/app/mobile-bottom-nav.tsx");

  assert.match(nicheNavigation, /feature: "adRadar"/);
  assert.match(nicheNavigation, /feature: "propertyCheck"/);
  assert.match(navigation, /niche\.nav\.items/);
  assert.match(nicheNavigation, /href: "\/ad-radar"[^\n]*feature: "adRadar"/);
  assert.match(nicheNavigation, /href: "\/property-check"[^\n]*feature: "propertyCheck"/);
  assert.match(navigation, /!item\.feature \|\| niche\.features\[item\.feature\]/);
  assert.doesNotMatch(mobile, /self_serve:\s*\[[^\]]*\/ad-radar/);
  assert.match(mobile, /niche\.nav\.mobileTabs/);
});

test("active Ad Studio generation has no local Ad Radar dependency", () => {
  const dialog = read("src/components/adstudio/new-ad-dialog.tsx");
  const progress = read("src/components/adstudio/generation-progress.tsx");
  const styles = read("src/components/adstudio/styles.ts");

  assert.match(dialog, /GenerationProgress/);
  assert.match(dialog, /template=\{generationTemplate\}/);
  assert.doesNotMatch(dialog, /GenerationAdStream|preloadGenerationAdStream|generationAdLocation|local-ad-radar/);
  assert.doesNotMatch(progress, /fetch\(|local-ad-radar|ad-radar/);
  assert.doesNotMatch(progress, /useEffect|useState|setInterval|Running final checks/);
  assert.match(progress, /Creating your Feed and Story ads/);
  assert.match(progress, /templateDisplaySrc/);
  assert.match(progress, /aria-hidden="true"/);
  assert.doesNotMatch(progress, /<(?:a|button)\b/);
  assert.equal((progress.match(/<figure\b/g) ?? []).length, 1);
  assert.doesNotMatch(progress, /\.map\(|SHOWCASE_LIMIT|showcase-track|showcase-set/);
  assert.match(styles, /\.studio-generation-showcase\{[^}]*pointer-events:none/);
  assert.match(styles, /\.studio-generation-showcase\{[^}]*container-type:size[^}]*place-items:center/);
  assert.match(styles, /\.studio-generation-showcase-card\{[^}]*100cqw[^}]*100cqh/);
  assert.match(styles, /\.studio-generation-showcase-card img\{[^}]*object-fit:contain/);
  assert.doesNotMatch(styles, /studio-generation-scroll|studio-generation-showcase-track|studio-generation-showcase-set/);
  assert.equal(existsSync("src/components/adstudio/generation-ad-stream.tsx"), false);
  assert.equal(existsSync("src/components/adstudio/generation-ad-stream-data.ts"), false);
});
