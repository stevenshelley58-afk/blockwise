import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createCrmClient, type CrmCallLog } from "../src/lib/crm/client.ts";
import { createCrmCommands } from "../src/lib/crm/commands.ts";
import { CrmError, isCrmConflict, isCrmUnavailable, mapFrappeError } from "../src/lib/crm/errors.ts";
import {
  CrmSiteNotProvisionedError,
  crmSiteForSlug,
  isValidCrmSite,
  requireCrmSite,
  resolveCrmSite,
} from "../src/lib/crm/site-resolution.ts";

const CONFIG = {
  baseUrl: "http://blockwise-crm-frontend:8080",
  apiKey: "test-api-key",
  apiSecret: "test-api-secret",
  timeoutMs: 1000,
};

const SITE = "acme.crm.internal";
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE = "22222222-2222-4222-8222-222222222222";

type ScriptStep = { status: number; body: unknown } | Error;

type FetchDouble = {
  impl: typeof fetch;
  calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string | undefined }>;
};

/** Scripted fetch. Each call consumes the next step; the last step repeats. */
function makeFetch(script: ScriptStep[]): FetchDouble {
  const calls: FetchDouble["calls"] = [];
  let index = 0;
  const impl = (async (input: unknown, init: unknown) => {
    const step = script[Math.min(index, script.length - 1)] as ScriptStep;
    index += 1;
    const options = (init ?? {}) as { method?: string; headers?: Record<string, string>; body?: unknown };
    calls.push({
      url: String(input),
      method: options.method ?? "GET",
      headers: options.headers ?? {},
      body: typeof options.body === "string" ? options.body : undefined,
    });
    if (step instanceof Error) throw step;
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      text: async () => JSON.stringify(step.body),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function transportFailure(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function makeClient(script: ScriptStep[], workspaceSite = SITE) {
  const fetchDouble = makeFetch(script);
  const client = createCrmClient({
    config: CONFIG,
    site: workspaceSite,
    fetchImpl: fetchDouble.impl,
    sleep: async () => undefined,
    maxAttempts: 2,
    retryDelayMs: 0,
  });
  return { client, fetchDouble, commands: createCrmCommands(client, WORKSPACE) };
}

function payloadOf(call: { body: string | undefined }): Record<string, unknown> {
  assert.ok(call.body, "expected a request body");
  return JSON.parse(call.body) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Minimal Supabase double for workspace -> site resolution
// ---------------------------------------------------------------------------

function makeSiteSupabase(rows: Array<{ workspace_id: string; crm_site: string; status?: string }>) {
  const table = () => {
    const builder: Record<string, unknown> = {};
    let single = false;
    let workspaceFilter: string | null = null;
    builder.select = () => builder;
    builder.eq = (column: string, value: unknown) => {
      if (column === "workspace_id") workspaceFilter = String(value);
      return builder;
    };
    builder.maybeSingle = () => {
      single = true;
      return builder;
    };
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      const found = rows.find((row) => row.workspace_id === workspaceFilter) ?? null;
      return Promise.resolve({ data: single ? found : rows, error: null }).then(resolve, reject);
    };
    return builder;
  };
  return { from: () => ({ select: table }) } as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------

describe("crm adapter", () => {
  describe("idempotent command replay", () => {
    it("replays the identical body after a transport failure, never a new command id", async () => {
      const { commands, fetchDouble } = makeClient([
        transportFailure("ECONNREFUSED", "connect ECONNREFUSED 172.18.0.5:8080"),
        { status: 200, body: { message: { lead: "CRM-LEAD-0001", created: true, stage: "New", revision: 1 } } },
      ]);

      const result = await commands.captureEnquiry({
        commandId: "crm-capture:" + WORKSPACE + ":meta:sub-77",
        sourceProvider: "meta",
        sourceSubmissionId: "sub-77",
        email: "buyer@example.test",
      });

      assert.equal(result.lead, "CRM-LEAD-0001");
      assert.equal(fetchDouble.calls.length, 2, "one initial attempt plus one bounded retry");

      const first = payloadOf(fetchDouble.calls[0]);
      const second = payloadOf(fetchDouble.calls[1]);
      assert.equal(first.command_id, "crm-capture:" + WORKSPACE + ":meta:sub-77");
      assert.deepEqual(second, first, "the retry must replay the identical body");
      assert.equal(fetchDouble.calls[0].headers.Host, SITE);
      assert.equal(fetchDouble.calls[0].headers.Authorization, "token test-api-key:test-api-secret");
    });

    it("sends the same command id when a producer replays the same capture", async () => {
      const message = { message: { lead: "CRM-LEAD-0001", created: false, stage: "New", revision: 1 } };
      const { commands, fetchDouble } = makeClient([{ status: 200, body: message }]);

      const input = {
        commandId: "crm-capture:" + WORKSPACE + ":meta:sub-77",
        sourceProvider: "meta",
        sourceSubmissionId: "sub-77",
      };
      const first = await commands.captureEnquiry(input);
      const second = await commands.captureEnquiry(input);

      assert.equal(first.lead, second.lead);
      assert.equal(fetchDouble.calls.length, 2);
      assert.equal(
        payloadOf(fetchDouble.calls[0]).command_id,
        payloadOf(fetchDouble.calls[1]).command_id,
        "a replay must reuse the original command id",
      );
    });

    it("never retries an HTTP response and maps a 5xx to crm_unavailable", async () => {
      const { commands, fetchDouble } = makeClient([
        { status: 500, body: { exc_type: "InternalError", exception: "boom" } },
      ]);

      await assert.rejects(
        () => commands.setStage({ commandId: "cmd-1", lead: "CRM-LEAD-1", stage: "Contacting" }),
        (error: unknown) => isCrmUnavailable(error),
      );
      assert.equal(fetchDouble.calls.length, 1, "an HTTP response is never retried");
    });

    it("refuses a command with no command id", async () => {
      const { commands, fetchDouble } = makeClient([{ status: 200, body: { message: {} } }]);
      await assert.rejects(
        () => commands.setStage({ commandId: "   ", lead: "CRM-LEAD-1", stage: "Contacting" }),
        /requires a command_id/,
      );
      assert.equal(fetchDouble.calls.length, 0, "nothing is sent without a command id");
    });
  });

  describe("stale revision conflict", () => {
    const staleBody = {
      exc_type: "ValidationError",
      _server_messages: JSON.stringify([
        { message: "This enquiry changed since you loaded it. Refresh and try again." },
      ]),
    };

    it("maps a stale revision to a 409 conflict without leaking Frappe internals", () => {
      const error = mapFrappeError(staleBody, 200);
      assert.equal(error.code, "conflict");
      assert.equal(error.status, 409);
      assert.ok(isCrmConflict(error));
      assert.equal(error.message, "This enquiry changed since you loaded it. Refresh and try again.");
      for (const leak of ["Traceback", "exc_type", "_server_messages", "ValidationError", "File \""]) {
        assert.ok(!error.message.includes(leak), "client message must not leak Frappe internals: " + leak);
      }
    });

    it("surfaces the conflict through a mutation and does not retry it", async () => {
      const { commands, fetchDouble } = makeClient([{ status: 200, body: staleBody }]);

      await assert.rejects(
        () =>
          commands.logContact({
            commandId: "cmd-stale",
            lead: "CRM-LEAD-1",
            expectedRevision: 3,
          }),
        (error: unknown) => error instanceof CrmError && error.code === "conflict",
      );
      assert.equal(fetchDouble.calls.length, 1, "a conflict is a decision, not a transport failure");
      assert.equal(payloadOf(fetchDouble.calls[0]).expected_revision, 3);
    });

    it("maps a missing enquiry to not_found rather than conflict", () => {
      const error = mapFrappeError({ exc_type: "DoesNotExistError", exception: "CRM Lead nope not found" }, 200);
      assert.equal(error.code, "not_found");
      assert.equal(error.status, 404);
      assert.ok(!isCrmConflict(error));
    });
  });

  describe("cross-workspace refusal", () => {
    it("scopes every read to the session workspace", async () => {
      const { commands, fetchDouble } = makeClient([{ status: 200, body: { message: { name: "CRM-LEAD-1" } } }]);
      await commands.getLead("CRM-LEAD-1");
      assert.equal(fetchDouble.calls.length, 1);
      const url = new URL(fetchDouble.calls[0].url);
      assert.equal(url.searchParams.get("workspace_id"), WORKSPACE);
      assert.ok(url.pathname.endsWith("/api/method/blockwise_crm.api.get_lead"));
    });

    it("cannot be steered at another workspace from the request body", async () => {
      const { commands, fetchDouble } = makeClient([{ status: 200, body: { message: { ok: true } } }]);
      await commands.reassign({
        commandId: "cmd-x",
        lead: "CRM-LEAD-1",
        assignee: "agent@agency.test",
      });
      const payload = payloadOf(fetchDouble.calls[0]);
      assert.equal(payload.workspace_id, WORKSPACE);
      assert.equal(Object.prototype.hasOwnProperty.call(payload, "workspace"), false);
    });

    it("maps a cross-workspace DoesNotExistError to not_found", async () => {
      const { commands, fetchDouble } = makeClient([
        { status: 200, body: { exc_type: "DoesNotExistError", exception: "CRM Lead CRM-LEAD-9 not found" } },
      ]);
      await assert.rejects(
        () => commands.getLead("CRM-LEAD-9"),
        (error: unknown) => error instanceof CrmError && error.code === "not_found",
      );
      assert.equal(new URL(fetchDouble.calls[0].url).searchParams.get("workspace_id"), WORKSPACE);
    });

    it("resolves a distinct site per workspace and refuses an unmapped workspace", async () => {
      const supabase = makeSiteSupabase([
        { workspace_id: WORKSPACE, crm_site: "acme.crm.internal" },
        { workspace_id: OTHER_WORKSPACE, crm_site: "bright.crm.internal" },
      ]);

      const mine = await resolveCrmSite(supabase, WORKSPACE);
      const theirs = await resolveCrmSite(supabase, OTHER_WORKSPACE);
      assert.equal(mine?.crmSite, "acme.crm.internal");
      assert.equal(theirs?.crmSite, "bright.crm.internal");
      assert.notEqual(mine?.crmSite, theirs?.crmSite, "agencies must never share a site");

      assert.equal(await resolveCrmSite(supabase, "33333333-3333-4333-8333-333333333333"), null);
      await assert.rejects(
        () => requireCrmSite(supabase, "33333333-3333-4333-8333-333333333333"),
        CrmSiteNotProvisionedError,
      );
    });

    it("rejects a stored site value that is not a bare hostname", async () => {
      const supabase = makeSiteSupabase([
        { workspace_id: WORKSPACE, crm_site: "http://evil.test/x" },
      ]);
      assert.equal(await resolveCrmSite(supabase, WORKSPACE), null);
      assert.equal(isValidCrmSite("acme.crm.internal"), true);
      assert.equal(isValidCrmSite("http://acme.crm.internal"), false);
      assert.equal(isValidCrmSite("acme.crm.internal:8080"), false);
      assert.equal(isValidCrmSite("acme crm.internal"), false);
    });

    it("derives the canonical site hostname from an agency slug", () => {
      assert.equal(crmSiteForSlug("acme"), "acme.crm.internal");
      assert.throws(() => crmSiteForSlug("Acme Realty"), /lowercase alphanumeric/);
      assert.throws(() => crmSiteForSlug("acme.realty"), /lowercase alphanumeric/);
    });
  });

  describe("call log", () => {
    it("records every request for observability", async () => {
      const { client, commands } = makeClient([{ status: 200, body: { message: { ok: true } } }]);
      await commands.recordEvent({ commandId: "cmd-e", lead: "CRM-LEAD-1", type: "note" });
      const calls: readonly CrmCallLog[] = client.calls;
      assert.equal(calls.length, 1);
      assert.equal(calls[0].site, SITE);
      assert.equal(calls[0].method, "blockwise_crm.api.record_event");
    });
  });
});
