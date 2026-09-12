import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createLeadApi,
  type LeadRequest,
  type LeadTransport,
  type LeadTransportResponse,
} from "../src/components/leads/api.ts";
import { EMAIL_DRAFT_EVENT, auditEmailDraft, openEmailDraft } from "../src/components/leads/email-draft.ts";
import {
  MAILTO_URL_CEILING,
  buildMailtoUrl,
  buildTelUrl,
  isMailtoTooLong,
  normalizeRecipient,
} from "../src/components/leads/mailto.ts";

const WORKSPACE = "workspace-test";
const LEAD = "LEAD-0001";

type FakeCrm = {
  leads: Record<string, { stage: string; revision: number }>;
  tasks: Record<string, { status: string }>;
};

/**
 * A transport that behaves like the real routes: a stage call moves the stage,
 * a task patch completes the task. If the email draft helper ever issued one of
 * those, the fake CRM below would show it.
 */
function recordingTransport(state: FakeCrm) {
  const calls: LeadRequest[] = [];
  const transport: LeadTransport = async (request: LeadRequest): Promise<LeadTransportResponse> => {
    calls.push(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (request.method !== "GET") {
      if (request.path.endsWith("/stage")) state.leads[LEAD].stage = String(body.stage ?? state.leads[LEAD].stage);
      if (request.path.endsWith("/activities")) state.leads[LEAD].stage = "Contacting";
      if (request.path.includes("/lead-tasks/")) state.tasks["TASK-0001"].status = "Done";
    }
    return { status: 200, body: { ok: true, commandId: "cmd-test", revision: state.leads[LEAD].revision } };
  };
  return { calls, transport };
}

function fakeCrm(): FakeCrm {
  return { leads: { [LEAD]: { stage: "New", revision: 4 } }, tasks: { "TASK-0001": { status: "Todo" } } };
}

function mutations(calls: LeadRequest[]): string[] {
  return calls.filter((call) => call.method !== "GET").map((call) => call.method + " " + call.path);
}

describe("mailto construction", () => {
  it("encodes the recipient, subject and body independently", () => {
    const url = buildMailtoUrl({ to: "avery@example.test", subject: "Hi & bye", body: "First line\nSecond line" });
    assert.equal(url, "mailto:avery%40example.test?subject=Hi%20%26%20bye&body=First%20line%0ASecond%20line");
  });

  it("rejects a recipient that could smuggle a header or a second address", () => {
    assert.equal(normalizeRecipient("avery@example.test?bcc=outside@example.test"), null);
    assert.equal(normalizeRecipient("avery@example.test\r\nBcc: outside@example.test"), null);
    assert.equal(normalizeRecipient("Avery <avery@example.test>"), null);
    assert.equal(normalizeRecipient("avery@example.test, other@example.test"), null);
    assert.equal(normalizeRecipient("not an email"), null);
    assert.equal(normalizeRecipient(null), null);
    assert.equal(normalizeRecipient("avery@example.test"), "avery@example.test");
  });

  it("never lets a newline survive into the subject", () => {
    const url = buildMailtoUrl({ to: "avery@example.test", subject: "Hi\nBcc: x@y.test", body: "Body\nBcc: x@y.test" });
    assert.ok(url);
    assert.doesNotMatch(url, /%0A{2}|Bcc%3A%20x%40y\.test%3F/);
    assert.match(url, /subject=Hi%20Bcc%3A%20x%40y\.test/);
  });

  it("rejects a draft it cannot open safely", () => {
    assert.equal(buildMailtoUrl({ to: "bad value", subject: "Hi", body: "Hi" }), null);
  });

  it("flags drafts over the encoded-url ceiling", () => {
    const long = buildMailtoUrl({ to: "avery@example.test", subject: "Hi", body: "x".repeat(MAILTO_URL_CEILING) });
    assert.ok(long);
    assert.equal(isMailtoTooLong(long), true);
    assert.equal(isMailtoTooLong("mailto:a%40b.test?subject=Hi&body=Hi"), false);
  });

  it("only builds a tel link from a dialable number", () => {
    assert.equal(buildTelUrl("(08) 9123-4567"), "tel:0891234567");
    assert.equal(buildTelUrl("not-a-phone"), null);
    assert.equal(buildTelUrl("+61 400 111 222\r\nX: y"), null);
  });
});

describe("opening the email draft helper", () => {
  it("does not change the stage and does not complete a task", async () => {
    const state = fakeCrm();
    const { calls, transport } = recordingTransport(state);
    const api = createLeadApi({ transport, workspaceId: WORKSPACE });
    const opened: string[] = [];

    const outcome = await openEmailDraft({
      leadId: LEAD,
      draft: { to: "avery@example.test", subject: "Your enquiry", body: "Hi Avery," },
      api,
      open: (url) => opened.push(url),
    });

    assert.equal(outcome.status, "opened");
    assert.equal(opened.length, 1);
    assert.match(opened[0], /^mailto:avery%40example\.test\?/);

    assert.deepEqual(mutations(calls), ["POST /api/leads/LEAD-0001/events"]);
    assert.equal(state.leads[LEAD].stage, "New");
    assert.equal(state.tasks["TASK-0001"].status, "Todo");

    const body = calls[0].body as Record<string, unknown>;
    assert.equal(body.type, EMAIL_DRAFT_EVENT);
    assert.equal(body.workspaceId, WORKSPACE);
  });

  it("records an audit note that claims nothing was sent, delivered or tracked", async () => {
    const state = fakeCrm();
    const { calls, transport } = recordingTransport(state);
    const api = createLeadApi({ transport, workspaceId: WORKSPACE });

    await openEmailDraft({
      leadId: LEAD,
      draft: { to: "avery@example.test", subject: "Hi", body: "Hi" },
      api,
      open: () => undefined,
    });

    const note = String((calls[0].body as Record<string, unknown>).note ?? "");
    assert.doesNotMatch(note, /\b(sent|delivered|delivered to|tracked|read by)\b/i);
    assert.equal(state.leads[LEAD].stage, "New");
  });

  it("sends nothing at all when the recipient cannot be used", async () => {
    const state = fakeCrm();
    const { calls, transport } = recordingTransport(state);
    const api = createLeadApi({ transport, workspaceId: WORKSPACE });
    const opened: string[] = [];

    const outcome = await openEmailDraft({
      leadId: LEAD,
      draft: { to: "avery@example.test?bcc=outside@example.test", subject: "Hi", body: "Hi" },
      api,
      open: (url) => opened.push(url),
    });

    assert.equal(outcome.status, "rejected");
    assert.equal(opened.length, 0);
    assert.deepEqual(mutations(calls), []);
    assert.equal(state.leads[LEAD].stage, "New");
  });

  it("does not open a draft that exceeds the URL ceiling", async () => {
    const state = fakeCrm();
    const { calls, transport } = recordingTransport(state);
    const api = createLeadApi({ transport, workspaceId: WORKSPACE });
    const opened: string[] = [];

    const outcome = await openEmailDraft({
      leadId: LEAD,
      draft: { to: "avery@example.test", subject: "Hi", body: "x".repeat(MAILTO_URL_CEILING) },
      api,
      open: (url) => opened.push(url),
    });

    assert.equal(outcome.status, "too_long");
    assert.equal(opened.length, 0);
    assert.deepEqual(mutations(calls), []);
  });

  it("audits a copy as the same audit-only event and changes nothing else", async () => {
    const state = fakeCrm();
    const { calls, transport } = recordingTransport(state);
    const api = createLeadApi({ transport, workspaceId: WORKSPACE });

    await auditEmailDraft({ leadId: LEAD, mode: "copied", api });

    assert.deepEqual(mutations(calls), ["POST /api/leads/LEAD-0001/events"]);
    assert.equal((calls[0].body as Record<string, unknown>).type, EMAIL_DRAFT_EVENT);
    assert.equal(state.leads[LEAD].stage, "New");
    assert.equal(state.tasks["TASK-0001"].status, "Todo");
  });
});
