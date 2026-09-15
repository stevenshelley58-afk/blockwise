import assert from "node:assert/strict";
import test from "node:test";

import { canAccessSurface } from "../src/lib/auth/access-control.ts";

test("operator surfaces require operator role", () => {
  assert.equal(canAccessSurface({ role: "operator", workspaceMode: "monitor" }, "operator"), true);
  assert.equal(canAccessSurface({ role: "owner", workspaceMode: "ad_studio" }, "operator"), false);
});

test("workspace mode does not restrict builder surfaces", () => {
  assert.equal(canAccessSurface({ role: "owner", workspaceMode: "monitor" }, "monitor"), true);
  assert.equal(canAccessSurface({ role: "owner", workspaceMode: "monitor" }, "ad_studio"), true);
  assert.equal(canAccessSurface({ role: "viewer", workspaceMode: "monitor" }, "monitor"), true);
  assert.equal(canAccessSurface({ role: "viewer", workspaceMode: "monitor" }, "ad_studio"), true);
});

test("ad-studio workspaces can access monitor and ad-studio surfaces", () => {
  assert.equal(canAccessSurface({ role: "member", workspaceMode: "ad_studio" }, "monitor"), true);
  assert.equal(canAccessSurface({ role: "member", workspaceMode: "ad_studio" }, "ad_studio"), true);
});

test("operator console (workforce, model control) is operator-only", () => {
  assert.equal(canAccessSurface({ role: "operator", workspaceMode: "ad_studio" }, "operator"), true);
  assert.equal(canAccessSurface({ role: "owner", workspaceMode: "ad_studio" }, "operator"), false);
  assert.equal(canAccessSurface({ role: "member", workspaceMode: "ad_studio" }, "operator"), false);
});

test("adbuilder is available to every role in any workspace mode", () => {
  const roles = ["owner", "admin", "member", "viewer", "operator"] as const;
  for (const role of roles) {
    assert.equal(canAccessSurface({ role, workspaceMode: "ad_studio" }, "adbuilder"), true);
    assert.equal(canAccessSurface({ role, workspaceMode: "monitor" }, "adbuilder"), true);
  }
});

test("property check is available to every role in any workspace mode", () => {
  const roles = ["owner", "admin", "member", "viewer", "operator"] as const;
  for (const role of roles) {
    assert.equal(canAccessSurface({ role, workspaceMode: "ad_studio" }, "property_check"), true);
    assert.equal(canAccessSurface({ role, workspaceMode: "monitor" }, "property_check"), true);
  }
});
