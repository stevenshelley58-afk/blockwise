import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const appShell = readFileSync("src/components/app-shell.tsx", "utf8");
const selfServeShell = readFileSync("src/components/self-serve-shell.tsx", "utf8");

test("AppShell renders every workspace through the unified self-serve shell", () => {
  assert.match(appShell, /<SelfServeShell/);
  assert.match(appShell, /\{children\}/);
  assert.match(appShell, /redirect\("\/login"\)/);
  assert.doesNotMatch(appShell, /RouteAwareLegacyShell/);
  assert.equal(existsSync("src/components/route-aware-legacy-shell.tsx"), false);
});

test("authenticated shell streams trial status behind a skeleton fallback", () => {
  assert.match(appShell, /<TrialStatusSkeleton \/>/);
  assert.match(appShell, /<DeferredTrialStatus/);
});

test("self-serve shell keeps Ads inside the shared customer shell", () => {
  assert.doesNotMatch(selfServeShell, /StudioShell/);
  assert.match(selfServeShell, /<SidebarProvider/);
  assert.match(selfServeShell, /<MobileBottomNav /);
  assert.match(selfServeShell, /navByVariant\.self_serve/);
});
