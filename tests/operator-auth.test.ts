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
    const dangerous = [
      "src/app/api/operator/database/rows/route.ts",
      "src/app/api/operator/database/schema/route.ts",
      "src/app/api/operator/prompts/route.ts",
      "src/app/api/operator/prompts/[key]/route.ts",
      "src/app/api/operator/prompts/[key]/test/route.ts",
      "src/app/api/operator/prompts/[key]/versions/route.ts",
      "src/app/api/operator/prompts/[key]/rollback/route.ts",
      "src/app/api/operator/prompts/[key]/versions/[version]/promote/route.ts",
      "src/app/api/operator/runtime-provider-credentials/sync/route.ts",
    ];
    for (const file of dangerous) {
      const source = readFileSync(file, "utf8");
      assert.match(source, /requireOwnerOperator\(\)/, `${file} must be owner-only`);
      assert.doesNotMatch(source, /requireOperator\(\)/, `${file} must not use the unscoped guard`);
    }
  });

  it("migration protects operator columns and ships an owner-only RPC", () => {
    const guard = readFileSync("supabase/migrations/20260901025000_protect_operator_roles.sql", "utf8");
    assert.match(guard, /operator role columns are protected/);
    assert.match(guard, /set_operator_role/);
    assert.match(guard, /operator_owner_required/);
    assert.match(guard, /revoke all on function public\.set_operator_role/i);
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
