import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  allowedMetaPartnerAccessTransition,
  createMetaPartnerAccessRequest,
  MetaPartnerAccessRequestError,
  normalizeMetaId,
  updateMetaPartnerAccessStatus,
} from "../src/lib/providers/meta-partner-access-requests.ts";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown> & {
  id: string;
  action: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  correlation_id: string | null;
};

/** Minimal audit_logs stub: insert stores, select/order returns the store. */
function auditStub() {
  const rows: Row[] = [];
  let clock = 0;
  const builder = {
    _filters: [] as Array<[string, unknown]>,
    select: () => builder,
    eq(column: string, value: unknown) {
      builder._filters.push([column, value]);
      return builder;
    },
    order: async () => {
      const filters = builder._filters;
      builder._filters = [];
      return {
        data: rows.filter((row) =>
          filters.every(([column, value]) => row[column] === value),
        ),
        error: null,
      } as never;
    },
    insert: async (row: Record<string, unknown>) => {
      if (rows.some((existing) => existing.id === row.id))
        return { error: { code: "23505", message: "duplicate" } };
      clock += 1;
      rows.push({
        ...row,
        created_at: new Date(2026, 0, 1, 0, 0, clock).toISOString(),
      } as Row);
      return { error: null };
    },
  };
  return {
    rows,
    client: { from: () => builder } as unknown as SupabaseClient,
  };
}

test("a confirmation-only request carries no asset IDs and accepts none", async () => {
  const { client, rows } = auditStub();
  const request = await createMetaPartnerAccessRequest({
    serviceSupabase: client,
    workspaceId: WORKSPACE_ID,
    actorProfileId: ACTOR_ID,
    mutationId: "33333333-3333-4333-8333-333333333333",
    requestType: "confirmation",
    // A typed ID is deliberately ignored on the confirmation path.
    adAccountId: "123456",
  });
  assert.equal(request.requestType, "confirmation");
  assert.equal(request.adAccountId, "");
  assert.equal(request.pageId, "");
  assert.equal(request.instagramAccountId, null);
  assert.equal(request.status, "requested");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.metadata?.adAccountId, null);
});

test("same-workspace retries return the original request", async () => {
  const { client, rows } = auditStub();
  const input = {
    serviceSupabase: client,
    workspaceId: WORKSPACE_ID,
    actorProfileId: ACTOR_ID,
    mutationId: "34343434-3434-4434-8434-343434343434",
    requestType: "assets" as const,
    adAccountId: "123456",
    pageId: "654321",
  };
  const created = await createMetaPartnerAccessRequest(input);
  const retried = await createMetaPartnerAccessRequest(input);

  assert.deepEqual(retried, created);
  assert.equal(rows.length, 1);
});

test("same-workspace retries with different inputs are rejected", async () => {
  const { client, rows } = auditStub();
  const mutationId = "35353535-3535-4535-8535-353535353535";
  await createMetaPartnerAccessRequest({
    serviceSupabase: client,
    workspaceId: WORKSPACE_ID,
    actorProfileId: ACTOR_ID,
    mutationId,
    requestType: "assets",
    adAccountId: "123456",
    pageId: "654321",
  });

  await assert.rejects(
    createMetaPartnerAccessRequest({
      serviceSupabase: client,
      workspaceId: WORKSPACE_ID,
      actorProfileId: ACTOR_ID,
      mutationId,
      requestType: "assets",
      adAccountId: "123457",
      pageId: "654321",
    }),
    (error: unknown) =>
      error instanceof MetaPartnerAccessRequestError &&
      error.code === "idempotency_conflict" &&
      error.status === 409,
  );
  assert.equal(rows.length, 1);
});

test("cross-workspace duplicate insert races cannot return another workspace request", async () => {
  const { client, rows } = auditStub();
  const mutationId = "36363636-3636-4636-8636-363636363636";
  await createMetaPartnerAccessRequest({
    serviceSupabase: client,
    workspaceId: OTHER_WORKSPACE_ID,
    actorProfileId: ACTOR_ID,
    mutationId,
    requestType: "assets",
    adAccountId: "123456",
    pageId: "654321",
  });

  await assert.rejects(
    createMetaPartnerAccessRequest({
      serviceSupabase: client,
      workspaceId: WORKSPACE_ID,
      actorProfileId: ACTOR_ID,
      mutationId,
      requestType: "assets",
      adAccountId: "777777",
      pageId: "888888",
    }),
    (error: unknown) =>
      error instanceof MetaPartnerAccessRequestError &&
      error.code === "idempotency_conflict" &&
      error.status === 409 &&
      error.message === "This request ID is already used for a different request.",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.workspace_id, OTHER_WORKSPACE_ID);
});

test("an operator records the verified IDs when marking a request ready", async () => {
  const { client } = auditStub();
  const created = await createMetaPartnerAccessRequest({
    serviceSupabase: client,
    workspaceId: WORKSPACE_ID,
    actorProfileId: ACTOR_ID,
    mutationId: "44444444-4444-4444-8444-444444444444",
    requestType: "confirmation",
  });

  await updateMetaPartnerAccessStatus({
    serviceSupabase: client,
    requestId: created.requestId,
    status: "verifying",
    reason: "Checking the shared-asset list in Meta.",
    actorProfileId: ACTOR_ID,
  });

  // Ready without the IDs the operator read from Meta is refused.
  await assert.rejects(
    updateMetaPartnerAccessStatus({
      serviceSupabase: client,
      requestId: created.requestId,
      status: "ready_for_manual_publishing",
      reason: "Assets match.",
      actorProfileId: ACTOR_ID,
    }),
    (error: unknown) =>
      error instanceof MetaPartnerAccessRequestError &&
      error.code === "invalid_input",
  );

  const ready = await updateMetaPartnerAccessStatus({
    serviceSupabase: client,
    requestId: created.requestId,
    status: "ready_for_manual_publishing",
    reason: "Assets match the shared-asset list.",
    actorProfileId: ACTOR_ID,
    verified: {
      adAccountId: "777777",
      pageId: "888888",
      instagramAccountId: "999999",
    },
  });
  assert.equal(ready.status, "ready_for_manual_publishing");
  assert.equal(ready.adAccountId, "act_777777");
  assert.equal(ready.pageId, "888888");
  assert.equal(ready.instagramAccountId, "999999");
});

test("typed-ID requests keep their request type and validation", async () => {
  const { client } = auditStub();
  const request = await createMetaPartnerAccessRequest({
    serviceSupabase: client,
    workspaceId: WORKSPACE_ID,
    actorProfileId: ACTOR_ID,
    mutationId: "55555555-5555-4555-8555-555555555555",
    requestType: "assets",
    adAccountId: "123456",
    pageId: "654321",
  });
  assert.equal(request.requestType, "assets");
  assert.equal(request.adAccountId, "act_123456");
  assert.equal(request.pageId, "654321");

  await assert.rejects(
    createMetaPartnerAccessRequest({
      serviceSupabase: client,
      workspaceId: WORKSPACE_ID,
      actorProfileId: ACTOR_ID,
      mutationId: "66666666-6666-4666-8666-666666666666",
      requestType: "assets",
      adAccountId: "not-an-id",
      pageId: "654321",
    }),
    (error: unknown) =>
      error instanceof MetaPartnerAccessRequestError &&
      error.code === "invalid_input",
  );
});

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
