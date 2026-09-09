import assert from "node:assert/strict";
import test from "node:test";

import { canAccessSurface } from "../src/lib/auth/access-control.ts";

test("operator surfaces require operator role", () => {
  assert.equal(canAccessSurface({ role: "operator", workspaceMode: "monitor" }, "operator"), true);
  assert.equal(canAccessSurface({ role: "owner", workspaceMode: "self_serve" }, "operator"), false);
});

test("workspace mode does not restrict builder surfaces", () => {
  assert.equal(canAccessSurface({ role: "owner", workspaceMode: "monitor" }, "monitor"), true);
  assert.equal(canAccessSurface({ role: "owner", workspaceMode: "monitor" }, "self_serve"), true);
  assert.equal(canAccessSurface({ role: "viewer", workspaceMode: "monitor" }, "monitor"), true);
  assert.equal(canAccessSurface({ role: "viewer", workspaceMode: "monitor" }, "self_serve"), true);
});

test("self-serve workspaces can access monitor and self-serve surfaces", () => {
  assert.equal(canAccessSurface({ role: "member", workspaceMode: "self_serve" }, "monitor"), true);
  assert.equal(canAccessSurface({ role: "member", workspaceMode: "self_serve" }, "self_serve"), true);
});

test("operator console (workforce, model control) is operator-only", () => {
  assert.equal(canAccessSurface({ role: "operator", workspaceMode: "self_serve" }, "operator"), true);
  assert.equal(canAccessSurface({ role: "owner", workspaceMode: "self_serve" }, "operator"), false);
  assert.equal(canAccessSurface({ role: "member", workspaceMode: "self_serve" }, "operator"), false);
});

test("adstudio is available to every role in any workspace mode", () => {
  const roles = ["owner", "admin", "member", "viewer", "operator"] as const;
  for (const role of roles) {
    assert.equal(canAccessSurface({ role, workspaceMode: "self_serve" }, "adstudio"), true);
    assert.equal(canAccessSurface({ role, workspaceMode: "monitor" }, "adstudio"), true);
  }
});

test("property check is available to every role in any workspace mode", () => {
  const roles = ["owner", "admin", "member", "viewer", "operator"] as const;
  for (const role of roles) {
    assert.equal(canAccessSurface({ role, workspaceMode: "self_serve" }, "property_check"), true);
    assert.equal(canAccessSurface({ role, workspaceMode: "monitor" }, "property_check"), true);
  }
});
