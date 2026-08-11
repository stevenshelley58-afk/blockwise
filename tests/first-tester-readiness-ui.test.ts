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
  }
  // The review copy lives in the workspace section now that the settings
  // view is a thin composer over per-section components.
  assert.match(sources[1], /All campaigns are reviewed before going live during early access\./);
});

test("billing settings prefer friendly portal messages and hide billing management until Stripe exists", () => {
  const source = [
    read("src/app/(customer)/settings/settings-view.tsx"),
    read("src/app/(customer)/settings/billing-section.tsx"),
  ].join("\n");

  assert.match(source, /message\?: string/);
  assert.match(source, /data\.message \?\? data\.error \?\? "Billing isn't connected yet\."/);
  assert.match(source, /workspace\.stripeCustomerId \?/);
  assert.match(source, /Billing management will appear here after your first paid plan is active\./);
  assert.match(source, /Usage this period/);
  assert.match(source, /workspace\.billingAccessState === "paid"/);
  assert.match(source, /complete Feed \+ Story packs/);
});

test("ad studio lead destination stays out of local-only workbench state", () => {
  // The campaign/landing panels that once held a local-only lead-destination
  // selector were deleted; the workbench must not reintroduce that state.
  const workbench = read("src/components/adstudio/ad-studio-customer-flow.tsx");

  assert.doesNotMatch(workbench, /leadDestination/);
  assert.doesNotMatch(workbench, /setLeadDestination/);
});

test("Meta OAuth notices handle missing code and never echo unknown provider errors", () => {
  const source = read("src/app/(customer)/results/page.tsx");

  assert.match(source, /error === "missing_code"/);
  assert.match(source, /Meta connection was cancelled or did not complete\. Try again\./);
  assert.match(source, /if \(error\) \{\s*return \{ tone: "error", message: "Meta connection could not be completed\. Please try again\." \};\s*\}/);
  assert.doesNotMatch(source, /message:\s*error/);
});

test("generation limit responses keep a machine code with friendly credit messages", () => {
  const source = read("src/lib/adstudio/generation-credits.ts");
  const domain = read("src/lib/credits/workspace-credits.ts");

  assert.match(source, /code:\s*error\.reason/);
  assert.match(source, /status:\s*402/);
  assert.match(domain, /reason === "credit_limit_reached"[\s\S]*not enough render credits/);
  assert.match(domain, /reason === "entitlement_expired"[\s\S]*credit period has ended/);
});

test("leads surface labels duplicate candidates as possible duplicates", () => {
  const source = read("src/config/niche/blockwise/leads.ts");
  const table = read("src/components/leads/leads-table.tsx");

  assert.match(source, /Possible duplicate/);
  assert.doesNotMatch(source, /Duplicate flagged/);
  assert.match(table, /copy\.status\.possibleDuplicate/);
});
