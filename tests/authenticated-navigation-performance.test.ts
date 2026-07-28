import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("customer shell and pages share one claims-based request auth context", () => {
  const context = read("src/lib/auth/request-context.ts");
  const workspaceAccess = read("src/lib/auth/workspace-access.ts");
  const shell = read("src/components/app-shell.tsx");
  const pageGuards = read("src/lib/auth/page-guards.ts");
  const settings = read("src/app/(customer)/settings/page.tsx");

  assert.match(context, /cache\(async \(\) =>/);
  assert.match(context, /supabase\.auth\.getClaims\(\)/);
  assert.match(context, /op: "auth\.claims"/);
  assert.match(context, /op: "db\.workspace_access"/);
  assert.doesNotMatch(context, /auth\.getUser\(\)/);
  assert.match(workspaceAccess, /supabase\.auth\.getClaims\(\)/);
  assert.doesNotMatch(workspaceAccess, /auth\.getUser\(\)/);

  assert.match(shell, /getRequestAuthContext\(\)/);
  assert.match(pageGuards, /getRequestAuthContext\(\)/);
  assert.doesNotMatch(shell, /auth\.getUser\(\)/);
  assert.doesNotMatch(pageGuards, /auth\.getUser\(\)/);
  assert.doesNotMatch(settings, /auth\.getUser\(\)/);
});

test("nonessential trial state streams without blocking the authenticated shell", () => {
  const shell = read("src/components/app-shell.tsx");
  const selfServeShell = read("src/components/self-serve-shell.tsx");

  assert.match(shell, /<Suspense fallback=\{null\}>/);
  assert.match(shell, /<DeferredTrialStatus/);
  assert.doesNotMatch(shell, /const initialTrialStatus = await loadInitialTrialStatus/);
  assert.match(selfServeShell, /trialStatus: React\.ReactNode/);
  assert.match(selfServeShell, /\{trialStatus\}/);
});

test("dynamic customer navigation has reusable loading boundaries and router cache", () => {
  const nextConfig = read("next.config.ts");
  const customerLoading = "src/app/(customer)/loading.tsx";
  const studioLoading = "src/app/(customer)/ad-studio/loading.tsx";

  assert.match(nextConfig, /staleTimes:\s*\{\s*dynamic: 30,\s*static: 180,/s);
  assert.equal(existsSync(customerLoading), true);
  assert.equal(existsSync(studioLoading), true);
  assert.match(read(customerLoading), /Loading Workspace|label="Workspace"/);
  assert.match(read(studioLoading), /Opening Ad Studio/);
  assert.equal(existsSync("src/app/(customer)/template.tsx"), false);
});

test("Home and Performance expose separate database and provider timing spans", () => {
  const home = read("src/app/(customer)/self-serve/page.tsx");
  const performance = read("src/app/(customer)/results/page.tsx");

  assert.match(home, /op: "db\.home_dashboard"/);
  assert.match(home, /op: "provider\.meta"/);
  assert.match(performance, /op: "provider\.meta"/);
});
