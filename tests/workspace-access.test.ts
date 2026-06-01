import assert from "node:assert/strict";
import test from "node:test";

import {
  canManageProviderConnections,
  resolveRequestedWorkspaceAccess,
} from "../src/modules/auth/workspace-access.ts";

test("provider connection management is limited to operators, owners, and admins", () => {
  assert.equal(canManageProviderConnections({ role: "operator", workspaceMode: "monitor" }), true);
  assert.equal(canManageProviderConnections({ role: "owner", workspaceMode: "monitor" }), true);
  assert.equal(canManageProviderConnections({ role: "admin", workspaceMode: "self_serve" }), true);
  assert.equal(canManageProviderConnections({ role: "member", workspaceMode: "self_serve" }), false);
  assert.equal(canManageProviderConnections({ role: "viewer", workspaceMode: "monitor" }), false);
});

test("non-operators cannot request arbitrary workspace IDs", () => {
  const access = resolveRequestedWorkspaceAccess({
    isOperator: false,
    memberships: [
      {
        workspaceId: "workspace_allowed",
        workspaceMode: "monitor",
        role: "owner",
      },
    ],
    requestedWorkspaceId: "workspace_other",
    surface: "monitor",
  });

  assert.deepEqual(access, {
    ok: false,
    status: 403,
    error: "Workspace access is not allowed.",
  });
});

test("self-serve workspaces can view monitor while monitor workspaces cannot use self-serve", () => {
  assert.equal(
    resolveRequestedWorkspaceAccess({
      isOperator: false,
      memberships: [
        {
          workspaceId: "workspace_selfserve",
          workspaceMode: "self_serve",
          role: "member",
        },
      ],
      surface: "monitor",
    }).ok,
    true,
  );

  assert.equal(
    resolveRequestedWorkspaceAccess({
      isOperator: false,
      memberships: [
        {
          workspaceId: "workspace_monitor",
          workspaceMode: "monitor",
          role: "owner",
        },
      ],
      surface: "self_serve",
    }).status,
    403,
  );
});
