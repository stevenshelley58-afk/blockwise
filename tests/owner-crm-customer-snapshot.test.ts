import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { verifyOwnerCrmSnapshotRequest } from "../src/lib/owner-crm/auth.ts";
import {
  OWNER_CRM_SNAPSHOT_DEFAULT_PAGE_SIZE,
  OWNER_CRM_SNAPSHOT_INTERNAL_SCOPE,
  mapOwnerCrmSnapshotRow,
  parseOwnerCrmSnapshotPageRequest,
  readOwnerCrmCustomerSnapshotPage,
} from "../src/lib/owner-crm/customer-snapshot.ts";

const OBSERVED_AT = "2026-09-13T00:00:00.000Z";

function row(overrides: Record<string, unknown> = {}) {
  return {
    workspace_id: "11111111-1111-4111-8111-111111111111",
    billing_access_state: "unbilled",
    stripe_subscription_status: null,
    trial_state: "pending_delivery",
    trial_started_at: null,
    trial_ends_at: null,
    source_observed_at: OBSERVED_AT,
    owner_profile_id: "22222222-2222-4222-8222-222222222222",
    owner_full_name: "Owner One",
    owner_email: "owner@example.test",
    owner_count: 1,
    owner_profile_workspace_count: 1,
    owner_matches_created_by: true,
    owner_email_verified_at: "2026-09-13T00:00:00.000Z",
    marketing_consent_event_id: "55555555-5555-4555-8555-555555555555",
    marketing_consent_granted: true,
    marketing_consent_occurred_at: "2026-09-13T00:00:00.000Z",
    marketing_consent_policy_version: "2026-09-13",
    ...overrides,
  };
}

test("owner CRM pagination is bounded and rejects malformed cursors", () => {
  assert.deepEqual(parseOwnerCrmSnapshotPageRequest(new URLSearchParams()), {
    afterWorkspaceId: null,
    limit: OWNER_CRM_SNAPSHOT_DEFAULT_PAGE_SIZE,
  });
  assert.throws(() => parseOwnerCrmSnapshotPageRequest(new URLSearchParams("limit=101")), /invalid_page_limit/);
  assert.throws(() => parseOwnerCrmSnapshotPageRequest(new URLSearchParams("limit=1.5")), /invalid_page_limit/);
  assert.throws(() => parseOwnerCrmSnapshotPageRequest(new URLSearchParams("afterWorkspaceId=not-a-uuid")), /invalid_page_cursor/);
});

test("snapshot projection keeps stable IDs when owner email addresses are shared", async () => {
  const calls: Array<{ functionName: string; args: unknown }> = [];
  const page = await readOwnerCrmCustomerSnapshotPage({
    rpc: async (functionName, args) => {
      calls.push({ functionName, args });
      return {
        data: [
          row(),
          row({
            workspace_id: "33333333-3333-4333-8333-333333333333",
            owner_profile_id: "44444444-4444-4444-8444-444444444444",
            owner_full_name: "Owner Two",
          }),
        ],
        error: null,
      };
    },
  }, { afterWorkspaceId: null, limit: 2 });

  assert.equal(calls[0].functionName, "owner_crm_customer_snapshot_page");
  assert.deepEqual(calls[0].args, { p_after_workspace_id: null, p_limit: 2 });
  assert.equal(page.items[0].owner?.profileId, "22222222-2222-4222-8222-222222222222");
  assert.equal(page.items[1].owner?.profileId, "44444444-4444-4444-8444-444444444444");
  assert.equal(page.items[0].owner?.email, page.items[1].owner?.email);
  assert.equal(page.nextAfterWorkspaceId, "33333333-3333-4333-8333-333333333333");
  assert.equal(page.sourceObservedAt, OBSERVED_AT);
});

test("snapshot marks ambiguous ownership instead of selecting a person", () => {
  const multipleOwners = mapOwnerCrmSnapshotRow(row({ owner_count: 2 }));
  assert.equal(multipleOwners.owner, null);
  assert.deepEqual(multipleOwners.mappingAmbiguities, ["owner_multiple_memberships"]);

  const multiWorkspaceOwner = mapOwnerCrmSnapshotRow(row({ owner_profile_workspace_count: 2 }));
  assert.equal(multiWorkspaceOwner.owner, null);
  assert.deepEqual(multiWorkspaceOwner.mappingAmbiguities, ["owner_profile_multiple_workspaces"]);
});

test("snapshot preserves raw billing, subscription, and pending trial facts", () => {
  const snapshot = mapOwnerCrmSnapshotRow(row({ stripe_subscription_status: "past_due" }));
  assert.equal(snapshot.billingAccessState, "unbilled");
  assert.equal(snapshot.stripeSubscriptionStatus, "past_due");
  assert.deepEqual(snapshot.trial, { state: "pending_delivery", startedAt: null, endsAt: null });
  assert.equal("productAccessStatus" in snapshot, false);
});

test("projection omits private billing and provider fields", () => {
  const serialized = JSON.stringify(mapOwnerCrmSnapshotRow(row())).toLowerCase();
  for (const forbidden of ["stripe_customer", "card", "token", "provider", "metadata", "billing_offer"]) {
    assert.equal(serialized.includes(forbidden), false, `projection included ${forbidden}`);
  }
});

test("owner CRM requires HMAC headers even while legacy bearer compatibility exists", async () => {
  const previousDedicated = process.env.OWNER_CRM_SNAPSHOT_AUTH_SECRET;
  process.env.OWNER_CRM_SNAPSHOT_AUTH_SECRET = "dedicated-owner-crm-secret-0123456789abcdef";
  let verifierCalled = false;
  try {
    const bearer = await verifyOwnerCrmSnapshotRequest(
      new Request("https://blockwise.test/api/internal/ops/owner-crm-snapshot", {
        headers: { authorization: "Bearer customer-session-token" },
      }),
      async () => {
        verifierCalled = true;
        return { ok: true, scope: OWNER_CRM_SNAPSHOT_INTERNAL_SCOPE };
      },
    );
    assert.deepEqual(bearer, { ok: false, status: 401, error: "legacy_bearer_not_permitted" });
    assert.equal(verifierCalled, false);

    const missing = await verifyOwnerCrmSnapshotRequest(
      new Request("https://blockwise.test/api/internal/ops/owner-crm-snapshot"),
      async (_request, scope, options) => {
        assert.equal(scope, OWNER_CRM_SNAPSHOT_INTERNAL_SCOPE);
        assert.equal(options?.secret, process.env.OWNER_CRM_SNAPSHOT_AUTH_SECRET);
        return { ok: false, status: 401, error: "missing_internal_auth_headers" };
      },
    );
    assert.deepEqual(missing, { ok: false, status: 401, error: "missing_internal_auth_headers" });
  } finally {
    if (previousDedicated === undefined) delete process.env.OWNER_CRM_SNAPSHOT_AUTH_SECRET;
    else process.env.OWNER_CRM_SNAPSHOT_AUTH_SECRET = previousDedicated;
  }
});

test("owner CRM never falls back to the shared internal HMAC secret", async () => {
  const previousDedicated = process.env.OWNER_CRM_SNAPSHOT_AUTH_SECRET;
  const previousShared = process.env.BLOCKWISE_INTERNAL_AUTH_SECRET;
  delete process.env.OWNER_CRM_SNAPSHOT_AUTH_SECRET;
  process.env.BLOCKWISE_INTERNAL_AUTH_SECRET = "shared-internal-secret-must-not-authorize-0123456789";
  try {
    const result = await verifyOwnerCrmSnapshotRequest(
      new Request("https://blockwise.test/api/internal/ops/owner-crm-snapshot"),
    );
    assert.deepEqual(result, { ok: false, status: 503, error: "internal_auth_not_configured" });
  } finally {
    if (previousDedicated === undefined) delete process.env.OWNER_CRM_SNAPSHOT_AUTH_SECRET;
    else process.env.OWNER_CRM_SNAPSHOT_AUTH_SECRET = previousDedicated;
    if (previousShared === undefined) delete process.env.BLOCKWISE_INTERNAL_AUTH_SECRET;
    else process.env.BLOCKWISE_INTERNAL_AUTH_SECRET = previousShared;
  }
});

test("snapshot RPC rejects null limits and remains service-role-only", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260912060000_owner_crm_customer_snapshot.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /p_limit is null or p_limit < 1 or p_limit > 100/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /where wm\.workspace_id = workspace_page\.id/);
  assert.match(migration, /on cardinality\(owner_members\.profile_ids\) = 1/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /to service_role/);
  assert.doesNotMatch(migration, /grant execute[\s\S]+to authenticated/);
});


test("snapshot route forces no-store and does not log raw errors", () => {
  const route = readFileSync(
    new URL("../src/app/api/internal/ops/owner-crm-snapshot/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /const NO_STORE_HEADERS = \{ "Cache-Control": "no-store" \}/);
  assert.equal((route.match(/headers: NO_STORE_HEADERS/g) ?? []).length, 4);
  assert.match(route, /console\.error\("\[owner-crm-snapshot\] read failed"\)/);
  assert.doesNotMatch(route, /console\.error\([^\n]*error\.message/);
});

test("owner CRM dedicated secret is passed into the product runtime", () => {
  const compose = readFileSync(
    new URL("../infra/coolify/docker-compose.product.yml", import.meta.url),
    "utf8",
  );
  const productEnv = readFileSync(
    new URL("../infra/product/.env.example", import.meta.url),
    "utf8",
  );
  const localEnv = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  const authSource = readFileSync(new URL("../src/lib/owner-crm/auth.ts", import.meta.url), "utf8");

  assert.match(compose, /OWNER_CRM_SNAPSHOT_AUTH_SECRET: \$\{OWNER_CRM_SNAPSHOT_AUTH_SECRET:-\}/);
  assert.match(productEnv, /^OWNER_CRM_SNAPSHOT_AUTH_SECRET=replace-in-infisical$/m);
  assert.match(localEnv, /^OWNER_CRM_SNAPSHOT_AUTH_SECRET=$/m);
  assert.match(authSource, /const secret = process\.env\.OWNER_CRM_SNAPSHOT_AUTH_SECRET \?\? ""/);
  assert.match(authSource, /dedicated_secret_required/);
});


test("owner CRM refuses reuse of the global credential", async () => {
  const before = {dedicated: process.env.OWNER_CRM_SNAPSHOT_AUTH_SECRET, shared: process.env.BLOCKWISE_INTERNAL_AUTH_SECRET};
  try {
    process.env.OWNER_CRM_SNAPSHOT_AUTH_SECRET = process.env.BLOCKWISE_INTERNAL_AUTH_SECRET = "x".repeat(40);
    assert.deepEqual(await verifyOwnerCrmSnapshotRequest(new Request("https://blockwise.test/api/internal/ops/owner-crm-snapshot")),
      {ok:false,status:503,error:"dedicated_secret_required"});
  } finally {
    if (before.dedicated === undefined) delete process.env.OWNER_CRM_SNAPSHOT_AUTH_SECRET;
    else process.env.OWNER_CRM_SNAPSHOT_AUTH_SECRET = before.dedicated;
    if (before.shared === undefined) delete process.env.BLOCKWISE_INTERNAL_AUTH_SECRET;
    else process.env.BLOCKWISE_INTERNAL_AUTH_SECRET = before.shared;
  }
});


test("snapshot mirrors explicit consent facts without inferring eligibility", () => {
  const item = mapOwnerCrmSnapshotRow(row());
  assert.deepEqual(item.marketingConsent, {
    eventId: "55555555-5555-4555-8555-555555555555",
    granted: true,
    occurredAt: OBSERVED_AT,
    policyVersion: "2026-09-13",
  });
  assert.equal(item.ownerEmailVerifiedAt, OBSERVED_AT);

  for (const migrationName of [
    "20260913030100_owner_crm_snapshot_marketing_consent.sql",
    "20260913030200_correct_owner_crm_snapshot_marketing_consent.sql",
  ]) {
    const sql = readFileSync(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), "utf8");
    assert.match(sql, /order by e\.occurred_at desc,e\.id desc limit 1/);
    assert.match(sql, /owner_crm_owner_email_verified_at\(p_workspace_id uuid, p_profile_id uuid\)/);
    assert.match(sql, /member\.workspace_id = p_workspace_id/);
    assert.match(sql, /1 = \(\s*select count\(\*\)[\s\S]*peer\.workspace_id = p_workspace_id/);
    assert.match(sql, /case when cardinality\(owner_members\.profile_ids\) = 1[\s\S]*owner_crm_owner_email_verified_at\(workspace_page\.id/);
    assert.doesNotMatch(sql, /owner_crm_owner_email_verified_at\(owner_members\.profile_ids\[1\]\)/);
    assert.doesNotMatch(sql, /grant execute on function public\.owner_crm_owner_email_verified_at[\s\S]*to authenticated/);
  }
});

test("lifecycle projection preserves authoritative fields without manufacturing dates", () => {
  const snapshot = mapOwnerCrmSnapshotRow(row({billing_event_created: 1234, billing_checkout_completed_at: OBSERVED_AT, cancel_at_period_end: false, current_period_end: OBSERVED_AT, workspace_created_at: OBSERVED_AT}));
  assert.equal(snapshot.billingEventCreated, 1234);
  assert.equal(snapshot.billingCheckoutCompletedAt, OBSERVED_AT);
  assert.equal(snapshot.cancelAtPeriodEnd, false);
  assert.equal(snapshot.currentPeriodEnd, OBSERVED_AT);
  assert.equal(snapshot.workspaceCreatedAt, OBSERVED_AT);
  assert.equal(mapOwnerCrmSnapshotRow(row()).billingEventCreated, null);
});
