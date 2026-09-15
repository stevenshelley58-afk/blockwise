import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const appShell = readFileSync("src/components/app-shell.tsx", "utf8");
const routeShell = readFileSync("src/components/adbuilder/studio-route-shell.tsx", "utf8");
const adStudioShellSource = readFileSync("src/components/ad-studio-shell.tsx", "utf8");

test("AppShell delegates to one unified route-aware boundary", () => {
  assert.match(appShell, /<StudioRouteShell[\s\S]*workspaceName=\{workspaceName\}/);
  assert.match(appShell, /<StudioRouteShell[\s\S]*metaConnectionStatus=\{metaConnectionStatus\}/);
  assert.match(appShell, /<StudioRouteShell[\s\S]*>\s*\{children\}\s*<\/StudioRouteShell>/);
  assert.match(appShell, /redirect\("\/login"\)/);
  assert.doesNotMatch(appShell, /RouteAwareLegacyShell/);
  assert.doesNotMatch(appShell, /<AdStudioShell[\s\S]*>\s*\{children\}\s*<\/AdStudioShell>/);
  assert.equal(existsSync("src/components/route-aware-legacy-shell.tsx"), false);
});

test("unified boundary selects Studio or adStudio chrome without overlays", () => {
  assert.match(routeShell, /usePathname/);
  assert.match(routeShell, /pathname === "\/ad-builder" \|\| pathname\.startsWith\("\/ad-builder\/"/);
  assert.match(routeShell, /<StudioShell[\s\S]*workspaceName=\{workspaceName\}/);
  assert.match(routeShell, /<AdStudioShell[\s\S]*workspaceName=\{workspaceName\}/);
  assert.doesNotMatch(routeShell, /fixed\s+inset-0|absolute\s+inset-0/);
  assert.equal((routeShell.match(/<StudioShell/g) ?? []).length, 1);
  assert.equal((routeShell.match(/<AdStudioShell/g) ?? []).length, 1);
});

test("authenticated shell streams trial status behind a skeleton fallback", () => {
  assert.match(appShell, /<TrialStatusSkeleton \/>/);
  assert.match(appShell, /<DeferredTrialStatus/);
});

test("ad-studio shell keeps Ads inside the shared customer shell", () => {
  assert.doesNotMatch(adStudioShellSource, /<StudioShell/);
  assert.match(adStudioShellSource, /<SidebarProvider/);
  assert.match(adStudioShellSource, /<MobileBottomNav homeHref=/);
  assert.doesNotMatch(adStudioShellSource, /<MobileBottomNav variant=/);
  assert.match(adStudioShellSource, /navByVariant\.ad_studio/);
});
