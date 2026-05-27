import assert from "node:assert/strict";
import test from "node:test";

import { canAccessSurface } from "../src/lib/auth/access-control.ts";

test("operator surfaces require operator role", () => {
  assert.equal(canAccessSurface({ role: "operator", workspaceMode: "monitor" }, "operator"), true);
  assert.equal(canAccessSurface({ role: "owner", workspaceMode: "self_serve" }, "operator"), false);
});

test("monitor workspaces cannot access self-serve builder", () => {
  assert.equal(canAccessSurface({ role: "owner", workspaceMode: "monitor" }, "monitor"), true);
  assert.equal(canAccessSurface({ role: "owner", workspaceMode: "monitor" }, "self_serve"), false);
});

test("self-serve workspaces can access monitor and self-serve surfaces", () => {
  assert.equal(canAccessSurface({ role: "member", workspaceMode: "self_serve" }, "monitor"), true);
  assert.equal(canAccessSurface({ role: "member", workspaceMode: "self_serve" }, "self_serve"), true);
});
