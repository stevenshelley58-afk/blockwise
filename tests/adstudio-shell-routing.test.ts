import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appShell = readFileSync("src/components/app-shell.tsx", "utf8");
const routeAwareShell = readFileSync("src/components/route-aware-legacy-shell.tsx", "utf8");
const selfServeShell = readFileSync("src/components/self-serve-shell.tsx", "utf8");

test("AppShell delegates non-self-serve variants to one route-aware boundary", () => {
  assert.match(appShell, /<RouteAwareLegacyShell[\s\S]*studioWorkspaceName=\{studioWorkspaceName\}/);
  assert.match(appShell, /legacyWorkspaceName=\{workspaceName\}/);
  assert.match(appShell, /<RouteAwareLegacyShell[\s\S]*>\s*\{children\}\s*<\/RouteAwareLegacyShell>/);
  assert.doesNotMatch(appShell, /<RouteAwareLegacyShell[\s\S]*<div className="app-shell">/);
});

test("route-aware boundary selects Studio or legacy chrome without overlays", () => {
  assert.match(routeAwareShell, /usePathname/);
  assert.match(routeAwareShell, /pathname === "\/ad-studio" \|\| pathname\.startsWith\("\/ad-studio\/"\)/);
  assert.match(routeAwareShell, /<StudioShell[\s\S]*workspaceName=\{studioWorkspaceName\}/);
  assert.match(routeAwareShell, /return \(\s*<div className="app-shell">/);
  assert.doesNotMatch(routeAwareShell, /fixed\s+inset-0|absolute\s+inset-0/);
  assert.equal((routeAwareShell.match(/className="app-shell"/g) ?? []).length, 1);
});

test("self-serve shell retains its existing Studio route handoff", () => {
  assert.match(selfServeShell, /if \(pathname\.startsWith\("\/ad-studio"\)\)/);
  assert.match(selfServeShell, /<StudioShell[\s\S]*>\{children\}<\/StudioShell>/);
});
