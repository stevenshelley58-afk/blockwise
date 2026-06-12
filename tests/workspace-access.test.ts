import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { canManageProviderConnections } from "../src/lib/auth/access-control.ts";
import {
  hasOperatorAccessFromRows,
  resolveRequestedWorkspaceAccess,
} from "../src/lib/auth/workspace-access.ts";

test("provider connection management is limited to operators, owners, and admins", () => {
  assert.equal(canManageProviderConnections({ role: "operator", workspaceMode: "monitor" }), true);
  assert.equal(canManageProviderConnections({ role: "owner", workspaceMode: "monitor" }), true);
  assert.equal(canManageProviderConnections({ role: "admin", workspaceMode: "self_serve" }), true);
  assert.equal(canManageProviderConnections({ role: "member", workspaceMode: "self_serve" }), false);
  assert.equal(canManageProviderConnections({ role: "viewer", workspaceMode: "monitor" }), false);
});

test("operator access accepts profile flag and workspace operator role", () => {
  assert.equal(hasOperatorAccessFromRows({ is_operator: true }, []), true);
  assert.equal(hasOperatorAccessFromRows({ is_operator: false }, [{ role: "operator" }]), true);
  assert.equal(hasOperatorAccessFromRows({ is_operator: false }, [{ role: "owner" }]), false);
});

test("model profile routes use the shared operator predicate", () => {
  const store = readFileSync("src/lib/ai/model-profile-store.ts", "utf8");
  const patchRoute = readFileSync("src/app/api/model-profiles/[key]/route.ts", "utf8");
  const testRoute = readFileSync("src/app/api/model-profiles/[key]/test/route.ts", "utf8");

  assert.match(store, /hasOperatorAccessFromRows/);
  assert.match(store, /from\("workspace_members"\)[\s\S]*select\("role"\)[\s\S]*\.eq\("profile_id", user\.id\)/);
  assert.doesNotMatch(store, /if \(!profile\?\.is_operator\)/);
  assert.match(patchRoute, /ensureOperatorSession\(supabase\)/);
  assert.match(testRoute, /ensureOperatorSession\(supabase\)/);
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
