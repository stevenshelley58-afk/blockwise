import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  allowedMetaPartnerAccessTransition,
  normalizeMetaId,
} from "../src/lib/providers/meta-partner-access-requests.ts";

test("Meta asset IDs are normalized and bounded", () => {
  assert.equal(normalizeMetaId("123456", "account"), "act_123456");
  assert.equal(normalizeMetaId("act_123456", "account"), "act_123456");
  assert.equal(normalizeMetaId("123456", "page"), "123456");
  assert.equal(normalizeMetaId("123456", "instagram"), "123456");
  assert.equal(normalizeMetaId("act_bad", "account"), null);
  assert.equal(normalizeMetaId("12", "page"), null);
});

test("partner-access requests permit only explicit operator transitions", () => {
  assert.equal(
    allowedMetaPartnerAccessTransition("requested", "verifying"),
    true,
  );
  assert.equal(
    allowedMetaPartnerAccessTransition(
      "requested",
      "ready_for_manual_publishing",
    ),
    false,
  );
  assert.equal(
    allowedMetaPartnerAccessTransition(
      "verifying",
      "ready_for_manual_publishing",
    ),
    true,
  );
  assert.equal(
    allowedMetaPartnerAccessTransition("verifying", "needs_changes"),
    true,
  );
  assert.equal(
    allowedMetaPartnerAccessTransition("needs_changes", "verifying"),
    true,
  );
  assert.equal(
    allowedMetaPartnerAccessTransition(
      "ready_for_manual_publishing",
      "cancelled",
    ),
    true,
  );
  assert.equal(
    allowedMetaPartnerAccessTransition("cancelled", "verifying"),
    false,
  );
});

test("manual partner-access requests cannot activate or call Meta", async () => {
  const source = await readFile(
    "src/lib/providers/meta-partner-access-requests.ts",
    "utf8",
  );
  assert.match(source, /audit_logs/);
  assert.match(source, /correlation_id:\s*mutationId/);
  assert.match(source, /instagramAccountId/);
  assert.doesNotMatch(
    source,
    /provider_connections|META_SYSTEM_USER_TOKEN|graph\.facebook|fetch\s*\(/i,
  );
});

test("customer and operator routes enforce workspace and role boundaries", async () => {
  const [customer, operator] = await Promise.all([
    readFile(
      "src/app/api/integrations/meta/partner-access-request/route.ts",
      "utf8",
    ),
    readFile(
      "src/app/api/operator/meta-partner-access/[requestId]/route.ts",
      "utf8",
    ),
  ]);
  assert.match(customer, /requireApiWorkspace/);
  assert.match(customer, /requestedWorkspace/);
  assert.match(customer, /canManageProviderConnections/);
  assert.match(operator, /requireOperator/);
  assert.match(operator, /reason/);
  assert.doesNotMatch(
    `${customer}\n${operator}`,
    /provider_connections|partner-claim/i,
  );
});
