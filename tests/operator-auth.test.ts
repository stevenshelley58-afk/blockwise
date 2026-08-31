import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const authSource = readFileSync("src/lib/operator/auth.ts", "utf8");
const revokeRoute = readFileSync("src/app/api/operator/users/[userId]/revoke-sessions/route.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260901020000_operator_roles.sql", "utf8");

describe("operator role and session control contract", () => {
  it("guards are authenticated, role-aware and MFA-gated when configured", () => {
    assert.match(authSource, /auth\.getUser\(\)/);
    assert.match(authSource, /operator_role/);
    assert.match(authSource, /OPERATOR_MFA_REQUIRED === "true"/);
    assert.match(authSource, /currentLevel !== "aal2"/);
  });

  it("audits legacy break-glass email access with named actor", () => {
    assert.match(authSource, /operator\.break_glass_access/);
    assert.match(authSource, /actorProfileId: user\.id/);
    assert.match(authSource, /email: user\.email/);
  });

  it("restricts session revocation to owners and requires a reason", () => {
    assert.match(revokeRoute, /isOwnerRole\(auth\)/);
    assert.match(revokeRoute, /owner_role_required/);
    assert.match(revokeRoute, /A reason is required/);
    assert.match(revokeRoute, /ban_duration: "876000h"/);
    assert.match(revokeRoute, /operator\.revoke_sessions/);
    assert.match(revokeRoute, /metadata: \{ reason/);
  });

  it("migration adds owner/support roles and backfills existing operators as owners", () => {
    assert.match(migration, /operator_role text\s+check \(operator_role in \('owner', 'support'\)\)/);
    assert.match(migration, /where is_operator is true/);
    assert.match(migration, /Rollback:/);
    assert.doesNotMatch(migration, /drop table/i);
  });
});
