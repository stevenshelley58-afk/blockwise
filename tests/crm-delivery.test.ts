import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  LEAD_CRM_DELIVERY_KIND,
  crmCaptureCommandId,
  crmDeliveryEnabled,
  ensureLeadCrmDeliveryJob,
  markLeadCrmDeliveryError,
  queueLeadCrmDelivery,
} from "../src/lib/crm/delivery.ts";
import {
  executeLeadCrmDeliveryJobById,
  readAttribution,
  redactDeliveryError,
  splitName,
} from "../src/lib/crm/delivery-worker.ts";
import { CrmError } from "../src/lib/crm/errors.ts";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEAD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Row = Record<string, unknown>;

/**
 * Minimal stand-in for the service-role client, covering exactly the calls the
 * delivery code makes: the ensure RPC, the job read and update, and the lead
 * read. Chainable so the production call shapes stay unchanged.
 */
function fakeSupabase(options: { job?: Row | null; lead?: Row | null; rpc?: unknown; rpcError?: string | null } = {}) {
  const updates: Array<{ table: string; patch: Row }> = [];
  const rpcCalls: Array<{ name: string; args: Row }> = [];

  const builderFor = (table: string): Row => {
    const builder: Row = {
      select: () => builder,
      eq: () => builder,
      update: (patch: Row) => {
        updates.push({ table, patch });
        return builder;
      },
      maybeSingle: () =>
        Promise.resolve({ data: table === "leads" ? (options.lead ?? null) : (options.job ?? null), error: null }),
      // `update(...).eq(...).eq(...)` is awaited directly, with no maybeSingle.
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
    };
    return builder;
  };

  const client = {
    rpc(name: string, args: Row) {
      rpcCalls.push({ name, args });
      if (options.rpcError) return Promise.resolve({ data: null, error: { message: options.rpcError } });
      return Promise.resolve({ data: options.rpc ?? null, error: null });
    },
    from(table: string) {
      return builderFor(table);
    },
  };

  return { client: client as unknown as SupabaseClient, updates, rpcCalls };
}

function jobRow(overrides: Row = {}): Row {
  return {
    id: JOB,
    workspace_id: WORKSPACE,
    lead_id: LEAD,
    source_provider: "meta",
    source_submission_id: "meta-lead-1",
    command_id: crmCaptureCommandId("meta", "meta-lead-1"),
    state: "pending",
    backfill: false,
    attempts: 0,
    crm_lead: null,
    last_error: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Producer side
// ---------------------------------------------------------------------------

test("the capture command id is derived from the source identity", () => {
  // A generated id would differ per attempt and the CRM would capture the same
  // enquiry twice, so this must be a pure function of the source.
  assert.equal(crmCaptureCommandId("meta", "abc"), "crm-capture:meta:abc");
  assert.equal(crmCaptureCommandId("meta", "abc"), crmCaptureCommandId("meta", "abc"));
  assert.notEqual(crmCaptureCommandId("meta", "abc"), crmCaptureCommandId("meta", "abd"));
  assert.notEqual(crmCaptureCommandId("meta", "abc"), crmCaptureCommandId("other", "abc"));
});

test("ensuring a delivery job sends the derived command id and normalises the row", async () => {
  const supabase = fakeSupabase({ rpc: jobRow() });

  const job = await ensureLeadCrmDeliveryJob({
    serviceSupabase: supabase.client,
    workspaceId: WORKSPACE,
    leadId: LEAD,
    sourceProvider: "meta",
    sourceSubmissionId: "meta-lead-1",
  });

  const call = supabase.rpcCalls[0];
  assert.equal(call?.name, "ensure_lead_crm_delivery_job");
  assert.equal(call?.args.p_workspace_id, WORKSPACE);
  assert.equal(call?.args.p_lead_id, LEAD);
  assert.equal(call?.args.p_source_provider, "meta");
  assert.equal(call?.args.p_source_submission_id, "meta-lead-1");
  assert.equal(call?.args.p_command_id, "crm-capture:meta:meta-lead-1");
  assert.equal(call?.args.p_backfill, false);

  assert.equal(job.id, JOB);
  assert.equal(job.state, "pending");
  assert.equal(job.command_id, "crm-capture:meta:meta-lead-1");
});

test("an explicit backfill flag reaches the RPC", async () => {
  const supabase = fakeSupabase({ rpc: jobRow({ backfill: true }) });

  const job = await ensureLeadCrmDeliveryJob({
    serviceSupabase: supabase.client,
    workspaceId: WORKSPACE,
    leadId: LEAD,
    sourceProvider: "meta",
    sourceSubmissionId: "meta-lead-1",
    backfill: true,
  });

  assert.equal(supabase.rpcCalls[0]?.args.p_backfill, true);
  assert.equal(job.backfill, true);
});

test("a composite returned as a one-element array is accepted too", async () => {
  // PostgREST hands a composite back as an array or a bare object depending on
  // the call, so assuming one shape would fail intermittently.
  const supabase = fakeSupabase({ rpc: [jobRow()] });

  const job = await ensureLeadCrmDeliveryJob({
    serviceSupabase: supabase.client,
    workspaceId: WORKSPACE,
    leadId: LEAD,
    sourceProvider: "meta",
    sourceSubmissionId: "meta-lead-1",
  });

  assert.equal(job.id, JOB);
});

test("an unknown state is treated as pending rather than trusted", async () => {
  const supabase = fakeSupabase({ rpc: jobRow({ state: "something-new" }) });

  const job = await ensureLeadCrmDeliveryJob({
    serviceSupabase: supabase.client,
    workspaceId: WORKSPACE,
    leadId: LEAD,
    sourceProvider: "meta",
    sourceSubmissionId: "meta-lead-1",
  });

  assert.equal(job.state, "pending");
});

test("a refused ensure surfaces as an error rather than a silent skip", async () => {
  const supabase = fakeSupabase({ rpcError: "permission denied" });

  await assert.rejects(
    () =>
      ensureLeadCrmDeliveryJob({
        serviceSupabase: supabase.client,
        workspaceId: WORKSPACE,
        leadId: LEAD,
        sourceProvider: "meta",
        sourceSubmissionId: "meta-lead-1",
      }),
    /ensure_lead_crm_delivery_job failed/,
  );
});

test("an ensure that returns no row is an error, not a null job", async () => {
  const supabase = fakeSupabase({ rpc: null });

  await assert.rejects(
    () =>
      ensureLeadCrmDeliveryJob({
        serviceSupabase: supabase.client,
        workspaceId: WORKSPACE,
        leadId: LEAD,
        sourceProvider: "meta",
        sourceSubmissionId: "meta-lead-1",
      }),
    /returned no delivery job/,
  );
});

test("queueing uses a job-scoped dedupe key", async () => {
  const enqueued: Array<Record<string, unknown>> = [];

  await queueLeadCrmDelivery({
    workspaceId: WORKSPACE,
    jobId: JOB,
    enqueue: ((input: Record<string, unknown>) => {
      enqueued.push(input);
      return Promise.resolve({ id: "queue-1" });
    }) as never,
  });

  assert.equal(enqueued[0]?.kind, LEAD_CRM_DELIVERY_KIND);
  assert.equal(enqueued[0]?.dedupeKey, `deliver-lead-crm:${WORKSPACE}:${JOB}`);
  assert.deepEqual(enqueued[0]?.payload, { workspaceId: WORKSPACE, jobId: JOB });
});

test("the delivery gate is off unless explicitly enabled", () => {
  const env = (value?: string) =>
    (value === undefined ? {} : { BLOCKWISE_ENABLE_CRM_DELIVERY: value }) as unknown as NodeJS.ProcessEnv;

  assert.equal(crmDeliveryEnabled(env()), false);
  assert.equal(crmDeliveryEnabled(env("false")), false);
  assert.equal(crmDeliveryEnabled(env("TRUE")), false);
  assert.equal(crmDeliveryEnabled(env("true")), true);
});

// ---------------------------------------------------------------------------
// Worker side
// ---------------------------------------------------------------------------

function withDeliveryEnabled<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.BLOCKWISE_ENABLE_CRM_DELIVERY;
  process.env.BLOCKWISE_ENABLE_CRM_DELIVERY = "true";
  return run().finally(() => {
    if (previous === undefined) delete process.env.BLOCKWISE_ENABLE_CRM_DELIVERY;
    else process.env.BLOCKWISE_ENABLE_CRM_DELIVERY = previous;
  });
}

function captureStub(handler?: (input: Row) => unknown) {
  const calls: Row[] = [];
  const createCrm = (async () => ({
    commands: {
      captureEnquiry: (input: Row) => {
        calls.push(input);
        return Promise.resolve(handler ? handler(input) : { lead: "CRM-LEAD-2026-00014", created: true, stage: "New", revision: 1 });
      },
    },
  })) as never;
  return { createCrm, calls };
}

test("delivery refuses to run while the gate is off", async () => {
  const supabase = fakeSupabase({ job: jobRow() });
  delete process.env.BLOCKWISE_ENABLE_CRM_DELIVERY;

  await assert.rejects(
    () =>
      executeLeadCrmDeliveryJobById({
        serviceSupabase: supabase.client,
        workspaceId: WORKSPACE,
        jobId: JOB,
      }),
    /disabled by BLOCKWISE_ENABLE_CRM_DELIVERY/,
  );
  assert.equal(supabase.rpcCalls.length, 0);
});

test("a missing job is refused rather than captured blind", async () => {
  await withDeliveryEnabled(async () => {
    const supabase = fakeSupabase({ job: null });
    await assert.rejects(
      () =>
        executeLeadCrmDeliveryJobById({
          serviceSupabase: supabase.client,
          workspaceId: WORKSPACE,
          jobId: JOB,
        }),
      /No CRM delivery job/,
    );
  });
});

test("an already delivered job is not captured a second time", async () => {
  await withDeliveryEnabled(async () => {
    const supabase = fakeSupabase({ job: jobRow({ state: "delivered", crm_lead: "CRM-LEAD-2026-00014" }) });
    const stub = captureStub();

    const result = await executeLeadCrmDeliveryJobById({
      serviceSupabase: supabase.client,
      workspaceId: WORKSPACE,
      jobId: JOB,
      createCrm: stub.createCrm,
    });

    // A redelivered queue message must not mint a second enquiry.
    assert.equal(stub.calls.length, 0);
    assert.equal(result.state, "delivered");
    assert.equal(result.crmLead, "CRM-LEAD-2026-00014");
    assert.equal(supabase.updates.length, 0);
  });
});

test("a pending job is captured with the job's own command id and marked delivered", async () => {
  await withDeliveryEnabled(async () => {
    const supabase = fakeSupabase({
      job: jobRow(),
      lead: { id: LEAD, full_name: "Ada Lovelace", email: "ada@example.com", phone: "0400000000", created_at: "2026-09-13T00:00:00Z", raw_payload: { campaign_id: "c1", ad_id: "a1", form_id: "f1" } },
    });
    const stub = captureStub();

    const result = await executeLeadCrmDeliveryJobById({
      serviceSupabase: supabase.client,
      workspaceId: WORKSPACE,
      jobId: JOB,
      createCrm: stub.createCrm,
    });

    const capture = stub.calls[0];
    // Replaying the stored command id is what makes a retry safe.
    assert.equal(capture?.commandId, "crm-capture:meta:meta-lead-1");
    assert.equal(capture?.sourceProvider, "meta");
    assert.equal(capture?.sourceSubmissionId, "meta-lead-1");
    assert.equal(capture?.firstName, "Ada");
    assert.equal(capture?.lastName, "Lovelace");
    assert.equal(capture?.email, "ada@example.com");
    assert.equal(capture?.phone, "0400000000");
    assert.equal(capture?.captureRecordId, LEAD);
    assert.equal(capture?.campaignId, "c1");
    assert.equal(capture?.adId, "a1");
    assert.equal(capture?.formId, "f1");
    assert.equal(capture?.backfill, false);

    const update = supabase.updates[0];
    assert.equal(update?.table, "lead_crm_delivery_jobs");
    assert.equal(update?.patch.state, "delivered");
    assert.equal(update?.patch.crm_lead, "CRM-LEAD-2026-00014");
    assert.equal(update?.patch.last_error, null);

    assert.equal(result.crmLead, "CRM-LEAD-2026-00014");
  });
});

test("a failed capture records a redacted reason and rethrows for the queue", async () => {
  await withDeliveryEnabled(async () => {
    const supabase = fakeSupabase({ job: jobRow(), lead: null });
    const stub = captureStub(() => {
      throw new CrmError("crm_unavailable", "connect ECONNREFUSED 10.0.0.1:8000");
    });

    await assert.rejects(
      () =>
        executeLeadCrmDeliveryJobById({
          serviceSupabase: supabase.client,
          workspaceId: WORKSPACE,
          jobId: JOB,
          createCrm: stub.createCrm,
        }),
      CrmError,
    );

    const update = supabase.updates[0];
    assert.equal(update?.patch.state, "error");
    // The row is readable by every workspace member, so it must carry a category,
    // never the connection string or any part of the credential.
    assert.equal(update?.patch.last_error, "crm:crm_unavailable");
    assert.doesNotMatch(String(update?.patch.last_error), /ECONNREFUSED|10\.0\.0\.1/);
  });
});

test("a backfilled job is captured as a backfill", async () => {
  await withDeliveryEnabled(async () => {
    const supabase = fakeSupabase({ job: jobRow({ backfill: true }), lead: { id: LEAD, full_name: "Ada" } });
    const stub = captureStub();

    await executeLeadCrmDeliveryJobById({
      serviceSupabase: supabase.client,
      workspaceId: WORKSPACE,
      jobId: JOB,
      createCrm: stub.createCrm,
    });

    assert.equal(stub.calls[0]?.backfill, true);
  });
});

test("an error write that itself fails does not mask the original failure", async () => {
  await withDeliveryEnabled(async () => {
    const supabase = fakeSupabase({ job: jobRow(), lead: null });
    // The job update is made to fail so the catch path has to survive it.
    (supabase.client as unknown as { from: (table: string) => unknown }).from = () => {
      const builder: Row = {
        select: () => builder,
        eq: () => builder,
        update: () => builder,
        maybeSingle: () => Promise.resolve({ data: jobRow(), error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: null, error: { message: "update refused" } }).then(resolve),
      };
      return builder;
    };
    const stub = captureStub(() => {
      throw new CrmError("unexpected");
    });

    await assert.rejects(
      () =>
        executeLeadCrmDeliveryJobById({
          serviceSupabase: supabase.client,
          workspaceId: WORKSPACE,
          jobId: JOB,
          createCrm: stub.createCrm,
        }),
      CrmError,
    );
  });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("a full name splits into first and last, and a single token stays first", () => {
  assert.deepEqual(splitName("Ada Lovelace"), { firstName: "Ada", lastName: "Lovelace" });
  assert.deepEqual(splitName("Ada Byron King Lovelace"), { firstName: "Ada", lastName: "Byron King Lovelace" });
  assert.deepEqual(splitName("Ada"), { firstName: "Ada", lastName: null });
  assert.deepEqual(splitName("   "), { firstName: null, lastName: null });
  assert.deepEqual(splitName(null), { firstName: null, lastName: null });
});

test("attribution is read only from string payload values", () => {
  assert.deepEqual(readAttribution({ campaign_id: "c1", ad_id: "a1", form_id: "f1" }), {
    campaignId: "c1",
    adId: "a1",
    formId: "f1",
  });
  assert.deepEqual(readAttribution({ campaign_id: "  ", ad_id: 42 }), {
    campaignId: null,
    adId: null,
    formId: null,
  });
  assert.deepEqual(readAttribution(null), { campaignId: null, adId: null, formId: null });
});

test("an unexpected error is reduced to its class, never its message", () => {
  // A thrown Error can carry a connection string or a credential in its message.
  assert.equal(redactDeliveryError(new CrmError("conflict")), "crm:conflict");
  assert.equal(redactDeliveryError(new Error("connect ECONNREFUSED 10.0.0.1:8000 with secret abc")), "Error");
  assert.equal(redactDeliveryError("plain string"), "error");
  assert.equal(redactDeliveryError(null), "error");
});

test("the error write truncates rather than storing an unbounded message", async () => {
  const supabase = fakeSupabase({ job: jobRow() });
  await markLeadCrmDeliveryError({
    serviceSupabase: supabase.client,
    workspaceId: WORKSPACE,
    jobId: JOB,
    message: "x".repeat(900),
  });

  assert.equal(String(supabase.updates[0]?.patch.last_error).length, 500);
});
