import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const home = readFileSync("src/components/self-serve/home-dashboard.tsx", "utf8");
const activation = readFileSync("src/components/self-serve/activation-card.tsx", "utf8");
const settings = readFileSync("src/app/(customer)/settings/settings-view.tsx", "utf8");

test("Home shows metrics, leads, and Perth ads without duplicating account UI", () => {
  assert.match(home, /leads/);
  assert.match(home, /perthAds/);
  // No workspace-name greeting and no setup card. Account detail and mobile
  // chrome still belong elsewhere: WorkspaceDetails on home would duplicate
  // Settings, and MobileSection is a settings-only primitive.
  assert.doesNotMatch(home, /<ActivationCard|<WorkspaceDetails|<MobileSection|data\.workspaceName/);
  assert.doesNotMatch(home, /Enquiry reporting unavailable/);
});

test("completed milestones remain accessible without occupying first-run space", () => {
  assert.match(activation, /<details[^>]*className="[^"]*mt-5/);
  assert.match(activation, /<summary[^>]*>[\s\S]*Completed milestones/);
  assert.match(activation, /const isComplete = activation\.currentStage/);
});

test("settings keeps every permitted section reachable and resolves deep links", () => {
  // Every permitted section still renders inside the tab layout.
  for (const section of [
    "AccountSection",
    "PasswordSection",
    "NotificationsSection",
    "WorkspaceSection",
    "TeamSection",
    "ConnectionsSection",
    "BillingSection",
    "DangerSection",
  ]) assert.ok(settings.includes("<" + section), `section ${section} is no longer reachable`);

  // Only tabs the layout actually renders can be selected.
  for (const tab of ["account", "workspace", "billing", "danger"]) {
    assert.ok(settings.includes('value="' + tab + '"'), `tab ${tab} is missing`);
  }
  assert.doesNotMatch(settings, /sectionClass|activeSection/);

  // Legacy section deep links (/settings#connections, #team, #billing, ...) still resolve.
  for (const id of ["account", "security", "notifications", "workspace", "team", "connections", "brand-pack", "billing", "danger"]) {
    assert.ok(
      settings.includes(id + ': "') || settings.includes('"' + id + '": "'),
      `legacy deep link "${id}" is not mapped to a tab`,
    );
  }
  assert.ok(settings.includes("function resolveTab"), "deep-link resolution is missing");
  assert.ok(settings.includes('?? "account"'), "an unknown deep link must fall back to Account");
  assert.ok(
    settings.includes('tab === "workspace" && !canManage ? "account" : tab'),
    "a non-manager must never land on Workspace",
  );

  // Both deep-link forms are read and kept in sync.
  assert.match(settings, /window\.location\.hash\.slice\(1\)/);
  assert.match(settings, /get\("section"\)/);
  assert.match(settings, /window\.addEventListener\("hashchange", readLocation\)/);
  assert.match(settings, /window\.addEventListener\("popstate", readLocation\)/);
});