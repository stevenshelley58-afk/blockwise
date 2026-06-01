import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceMode, WorkspaceRole } from "../src/modules/auth/access-control.ts";
import { deriveCapabilities, type Capability } from "../src/modules/auth/capabilities.ts";

const ROLES: WorkspaceRole[] = ["owner", "admin", "member", "viewer", "operator"];
const MODES: WorkspaceMode[] = ["monitor", "self_serve"];

const OPERATOR_ONLY: Capability[] = [
  "manage_all_workspaces",
  "run_for_client",
  "manage_hermes",
  "manage_api_controls",
  "manage_model_controls",
  "view_usage",
];
const READ: Capability[] = ["monitor_ads", "view_leads", "view_spend", "view_reports"];

test("operator-only capabilities are never granted to non-operators (all role x mode)", () => {
  for (const role of ROLES) {
    if (role === "operator") continue;
    for (const mode of MODES) {
      const caps = deriveCapabilities({ role, workspaceMode: mode, isOperator: false });
      for (const cap of OPERATOR_ONLY) {
        assert.equal(caps.has(cap), false, `${role}/${mode} must not have ${cap}`);
      }
    }
  }
});

test("every membership can read; authoring requires self-serve mode", () => {
  for (const role of ROLES) {
    for (const mode of MODES) {
      const caps = deriveCapabilities({ role, workspaceMode: mode, isOperator: false });
      for (const cap of READ) {
        assert.equal(caps.has(cap), true, `${role}/${mode} should read ${cap}`);
      }
      // Non-operator monitor-mode members can never author.
      if (role !== "operator" && mode === "monitor") {
        assert.equal(caps.has("create_ads"), false, `${role}/monitor must not author`);
      }
    }
  }
});

test("approve/publish is limited to owners, admins, and operators", () => {
  for (const role of ROLES) {
    for (const mode of MODES) {
      const caps = deriveCapabilities({ role, workspaceMode: mode, isOperator: false });
      const expected = role === "owner" || role === "admin" || role === "operator";
      assert.equal(caps.has("approve_ads"), expected, `approve_ads for ${role}/${mode}`);
      assert.equal(caps.has("publish_ads"), expected, `publish_ads for ${role}/${mode}`);
    }
  }
});

test("the isOperator flag grants the full capability set regardless of role/mode", () => {
  for (const role of ROLES) {
    for (const mode of MODES) {
      const caps = deriveCapabilities({ role, workspaceMode: mode, isOperator: true });
      for (const cap of [...OPERATOR_ONLY, ...READ, "create_ads", "approve_ads", "publish_ads"] as Capability[]) {
        assert.equal(caps.has(cap), true, `operator should have ${cap}`);
      }
    }
  }
});
