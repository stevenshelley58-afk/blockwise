import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("workspace settings show early-access review copy instead of a dead approval toggle", () => {
  const sources = [
    read("src/app/(customer)/settings/settings-view.tsx"),
    read("src/app/(customer)/settings/workspace-section.tsx"),
  ];

  for (const source of sources) {
    assert.doesNotMatch(source, /Require approval before publishing/);
    assert.doesNotMatch(source, /setApproval/);
    assert.doesNotMatch(source, /approval_required_by_default:\s*approval/);
    assert.match(source, /All campaigns are reviewed before going live during early access\./);
  }
});

test("billing settings prefer friendly portal messages and hide billing management until Stripe exists", () => {
  const source = read("src/app/(customer)/settings/settings-view.tsx");

  assert.match(source, /message\?: string/);
  assert.match(source, /data\.message \?\? data\.error \?\? "Billing isn't connected yet\."/);
  assert.match(source, /workspace\.stripeCustomerId \?/);
  assert.match(source, /Billing management will appear here after your first paid plan is active\./);
});

test("ad studio lead destination points to real connection settings instead of local-only state", () => {
  const campaignPanel = read("src/components/adstudio/panels/campaign-panel.tsx");
  const landingPanel = read("src/components/adstudio/panels/landing-panel.tsx");
  const workbench = read("src/components/adstudio/ad-studio-workbench.tsx");

  for (const source of [campaignPanel, landingPanel]) {
    assert.match(source, /href="\/settings#connections"/);
    assert.match(source, /Manage in Settings -> Connections/);
    assert.doesNotMatch(source, /<select value=\{leadDestination\}/);
    assert.doesNotMatch(source, /setLeadDestination/);
  }
  assert.doesNotMatch(workbench, /leadDestination/);
});

test("Meta OAuth notices handle missing code and never echo unknown provider errors", () => {
  const source = read("src/app/(customer)/results/page.tsx");

  assert.match(source, /error === "missing_code"/);
  assert.match(source, /Meta connection was cancelled or did not complete\. Try again\./);
  assert.match(source, /if \(error\) \{\s*return \{ tone: "error", message: "Meta connection could not be completed\. Please try again\." \};\s*\}/);
  assert.doesNotMatch(source, /message:\s*error/);
});

test("trial generation limit responses keep a machine code with friendly money-path messages", () => {
  const source = read("src/lib/adstudio/generation-trial.ts");

  assert.match(source, /trialCreditErrorMessage/);
  assert.match(source, /reason === "credit_limit_reached"[\s\S]*You've used all trial ad credits/);
  assert.match(source, /reason === "trial_expired"[\s\S]*Your trial has ended/);
  assert.match(source, /code:\s*reason \?\? "trial_credit_reservation_failed"/);
  assert.match(source, /status:\s*trialCreditErrorStatus\(reason\)/);
});
