import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const appShell = readFileSync("src/components/app-shell.tsx", "utf8");
const routeShell = readFileSync("src/components/adstudio/studio-route-shell.tsx", "utf8");
const selfServeShell = readFileSync("src/components/self-serve-shell.tsx", "utf8");

test("AppShell delegates to one unified route-aware boundary", () => {
  assert.match(appShell, /<StudioRouteShell[\s\S]*workspaceName=\{workspaceName\}/);
  assert.match(appShell, /<StudioRouteShell[\s\S]*metaConnectionStatus=\{metaConnectionStatus\}/);
  assert.match(appShell, /<StudioRouteShell[\s\S]*>\s*\{children\}\s*<\/StudioRouteShell>/);
  assert.match(appShell, /redirect\("\/login"\)/);
  assert.doesNotMatch(appShell, /RouteAwareLegacyShell/);
  assert.doesNotMatch(appShell, /<SelfServeShell[\s\S]*>\s*\{children\}\s*<\/SelfServeShell>/);
  assert.equal(existsSync("src/components/route-aware-legacy-shell.tsx"), false);
});

test("unified boundary selects Studio or SelfServe chrome without overlays", () => {
  assert.match(routeShell, /usePathname/);
  assert.match(routeShell, /pathname === "\/ad-studio" \|\| pathname\.startsWith\("\/ad-studio\/"/);
  assert.match(routeShell, /<StudioShell[\s\S]*workspaceName=\{workspaceName\}/);
  assert.match(routeShell, /<SelfServeShell[\s\S]*workspaceName=\{workspaceName\}/);
  assert.doesNotMatch(routeShell, /fixed\s+inset-0|absolute\s+inset-0/);
  assert.equal((routeShell.match(/<StudioShell/g) ?? []).length, 1);
  assert.equal((routeShell.match(/<SelfServeShell/g) ?? []).length, 1);
});

test("authenticated shell streams trial status behind a skeleton fallback", () => {
  assert.match(appShell, /<TrialStatusSkeleton \/>/);
  assert.match(appShell, /<DeferredTrialStatus/);
});

test("self-serve shell keeps Ads inside the shared customer shell", () => {
  assert.doesNotMatch(selfServeShell, /StudioShell/);
  assert.match(selfServeShell, /<SidebarProvider/);
  assert.match(selfServeShell, /<MobileBottomNav homeHref=/);
  assert.doesNotMatch(selfServeShell, /<MobileBottomNav variant=/);
  assert.match(selfServeShell, /navByVariant\.self_serve/);
});
