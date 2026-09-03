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

  it("requires is_operator AND a valid role; a role alone never grants access", () => {
    assert.match(authSource, /is_operator === true && operatorRole !== null/);
  });

  it("enforces the owner permission matrix for dangerous routes", () => {
    assert.match(authSource, /minimumRole === "owner" && effectiveRole !== "owner"/);
  });

  it("protects membership operator escalation and supports canonical role RPC", () => {
    const guard = readFileSync("supabase/migrations/20260901025000_protect_operator_roles.sql", "utf8");
    const canonical = readFileSync("supabase/migrations/20260901026000_canonical_operator_authority.sql", "utf8");
    assert.match(guard, /operator role columns are protected/);
    assert.match(guard, /set_operator_role/);
    assert.match(canonical, /workspace operator membership is service-managed/);
    assert.match(canonical, /last_operator_owner/);
    assert.match(canonical, /public\.is_operator/);
    assert.match(canonical, /private\.is_operator/);
    assert.match(canonical, /revoke_user_sessions/);
    assert.match(canonical, /pg_advisory_xact_lock/);
    assert.doesNotMatch(canonical, /current_user\s*=\s*'postgres'/);
  });

  it("audits legacy break-glass email access with named actor", () => {
    assert.match(authSource, /operator\.break_glass_access/);
    assert.match(authSource, /actorProfileId: user\.id/);
  });

  it("revokes sessions without long-term suspension and records durable intent/result", () => {
    assert.match(revokeRoute, /isOwnerRole\(auth\)/);
    assert.match(revokeRoute, /revoke_user_sessions/);
    assert.doesNotMatch(revokeRoute, /auth\.admin\.signOut/);
    assert.match(revokeRoute, /Cannot revoke your own sessions/);
    assert.match(revokeRoute, /Cannot revoke the last owner/);
    assert.match(revokeRoute, /operator\.revoke_sessions\.intent/);
    assert.match(revokeRoute, /phase: revokeError/);
  });

  it("migration adds owner/support roles without destructive edits", () => {
    assert.match(migration, /operator_role text\s+check \(operator_role in \('owner', 'support'\)\)/);
    assert.match(migration, /where is_operator is true/);
    assert.doesNotMatch(migration, /drop table/i);
  });
});
