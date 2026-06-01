import assert from "node:assert/strict";
import test from "node:test";

import { canAccessSurface } from "../src/modules/auth/access-control.ts";
import {
  capabilityForSurface,
  deriveCapabilities,
  hasCapability,
  type Capability,
  type CapabilityContext,
} from "../src/modules/auth/capabilities.ts";

const operator: CapabilityContext = { role: "operator", workspaceMode: "monitor", isOperator: true };
const monitorViewer: CapabilityContext = { role: "viewer", workspaceMode: "monitor", isOperator: false };
const monitorOwner: CapabilityContext = { role: "owner", workspaceMode: "monitor", isOperator: false };
const selfServeMember: CapabilityContext = { role: "member", workspaceMode: "self_serve", isOperator: false };
const selfServeOwner: CapabilityContext = { role: "owner", workspaceMode: "self_serve", isOperator: false };

test("operators receive every capability", () => {
  const caps = deriveCapabilities(operator);
  const everyCapability: Capability[] = [
    "monitor_ads",
    "view_leads",
    "view_spend",
    "view_reports",
    "create_ads",
    "edit_ads",
    "submit_for_approval",
    "manage_brand_kit",
    "approve_ads",
    "publish_ads",
    "manage_workspace",
    "manage_all_workspaces",
    "run_for_client",
    "manage_hermes",
    "manage_api_controls",
    "manage_model_controls",
    "view_usage",
  ];
  for (const capability of everyCapability) {
    assert.equal(caps.has(capability), true, `operator should have ${capability}`);
  }
});

test("monitor-only members can read but not author or approve", () => {
  assert.equal(hasCapability(monitorViewer, "monitor_ads"), true);
  assert.equal(hasCapability(monitorViewer, "view_leads"), true);
  assert.equal(hasCapability(monitorViewer, "create_ads"), false);
  assert.equal(hasCapability(monitorViewer, "approve_ads"), false);
  assert.equal(hasCapability(monitorViewer, "manage_all_workspaces"), false);
});

test("self-serve members can author ads but not approve or publish", () => {
  assert.equal(hasCapability(selfServeMember, "create_ads"), true);
  assert.equal(hasCapability(selfServeMember, "edit_ads"), true);
  assert.equal(hasCapability(selfServeMember, "submit_for_approval"), true);
  assert.equal(hasCapability(selfServeMember, "manage_brand_kit"), true);
  assert.equal(hasCapability(selfServeMember, "approve_ads"), false);
  assert.equal(hasCapability(selfServeMember, "publish_ads"), false);
});

test("self-serve owners keep approve, publish, and workspace management", () => {
  assert.equal(hasCapability(selfServeOwner, "approve_ads"), true);
  assert.equal(hasCapability(selfServeOwner, "publish_ads"), true);
  assert.equal(hasCapability(selfServeOwner, "manage_workspace"), true);
  assert.equal(hasCapability(selfServeOwner, "manage_all_workspaces"), false);
});

test("monitor-mode owners keep approval rights but not authoring", () => {
  // Preserves the legacy `approvals` surface, which allowed owner/admin in any mode.
  assert.equal(hasCapability(monitorOwner, "approve_ads"), true);
  assert.equal(hasCapability(monitorOwner, "create_ads"), false);
});

test("operator-only control planes are never granted to clients", () => {
  for (const context of [monitorOwner, selfServeOwner, selfServeMember, monitorViewer]) {
    assert.equal(hasCapability(context, "manage_hermes"), false);
    assert.equal(hasCapability(context, "manage_api_controls"), false);
    assert.equal(hasCapability(context, "manage_model_controls"), false);
    assert.equal(hasCapability(context, "run_for_client"), false);
  }
});

test("capability checks stay consistent with the legacy surface gate", () => {
  // Surfaces whose capability mapping is mode-independent should agree exactly
  // with canAccessSurface for the security-critical (operator-gated) surfaces.
  const contexts: CapabilityContext[] = [operator, monitorViewer, monitorOwner, selfServeMember, selfServeOwner];
  for (const context of contexts) {
    for (const surface of ["operator", "agents", "model_control", "monitor", "approvals"] as const) {
      const surfaceResult = canAccessSurface(context, surface);
      const capabilityResult = hasCapability(context, capabilityForSurface(surface));
      assert.equal(
        capabilityResult,
        surfaceResult,
        `surface ${surface} mismatch for role=${context.role} mode=${context.workspaceMode}`,
      );
    }
  }
});
