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

test("settings exposes every permitted section and keeps deep-link query support", () => {
  for (const id of ["account", "connections", "security", "billing", "notifications", "danger"]) {
    assert.match(settings, new RegExp('id: "' + id + '"'));
    assert.match(settings, new RegExp('data-settings-section="' + id + '"'));
  }
  assert.match(settings, /get\("section"\)/);
  assert.match(settings, /searchParams\.delete\("section"\)/);
  assert.match(settings, /history\.state/);
  assert.doesNotMatch(settings, /id="(?:account|connections|security|billing|notifications|danger)"/);
  assert.match(settings, /const sectionClass = \(id: string\) => selected === id \? "block" : "hidden"/);
});
