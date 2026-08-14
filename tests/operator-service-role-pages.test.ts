import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("operator pages render a friendly service-role configuration state", () => {
  const helper = readFileSync("src/lib/operator/service-role.ts", "utf8");
  const notice = readFileSync("src/components/operator/service-role-required.tsx", "utf8");

  assert.match(helper, /createOperatorSupabaseServiceClient/);
  assert.match(helper, /isMissingSupabaseServiceRoleError/);
  assert.match(helper, /return null/);
  assert.match(notice, /Operator data is unavailable/);
  assert.match(notice, /SUPABASE_SERVICE_ROLE_KEY/);
});
