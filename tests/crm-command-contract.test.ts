import assert from "node:assert/strict";
import test from "node:test";

import type { CrmClient } from "../src/lib/crm/client.ts";
import { createCrmCommands, type CrmCommands } from "../src/lib/crm/commands.ts";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const SITE = "demo.crm.internal";

type RecordedCall = {
  method: string;
  payload?: Record<string, unknown>;
  query?: Record<string, unknown>;
};

/**
 * Stand-in transport that records what the command layer puts on the wire.
 *
 * The other half of this contract lives in `blockwise_crm/api.py`, which reads
 * these exact keys. A rename on either side is a silent no-op at runtime - the
 * field simply arrives as null - so the names are pinned here rather than
 * discovered in production.
 */
function stubClient(handlers: { read?: unknown; call?: unknown } = {}) {
  const calls: RecordedCall[] = [];
  const client = {
    site: SITE,
    baseUrl: "http://crm.internal",
    calls: [],
    call<T>(method: string, payload?: Record<string, unknown>) {
      calls.push({ method, payload });
      return Promise.resolve((handlers.call ?? {}) as T);
    },
    read<T>(method: string, query?: Record<string, unknown>) {
      calls.push({ method, query });
      return Promise.resolve((handlers.read ?? {}) as T);
    },
  };
  return { client: client as unknown as CrmClient, calls };
}

function build(handlers: { read?: unknown; call?: unknown } = {}) {
  const stub = stubClient(handlers);
  return { ...stub, commands: createCrmCommands(stub.client, WORKSPACE) };
}

const LEAD = "CRM-LEAD-0001";
const TASK = "CRM-TASK-0001";

/** Every mutating command, called the way the customer interface calls it. */
const MUTATIONS: { command: string; run: (c: CrmCommands) => Promise<unknown> }[] = [
  {
    command: "capture_enquiry",
    run: (c) =>
      c.captureEnquiry({ commandId: "cmd", sourceProvider: "facebook", sourceSubmissionId: "sub" }),
  },
  { command: "log_contact", run: (c) => c.logContact({ commandId: "cmd", lead: LEAD, expectedRevision: 1 }) },
  { command: "log_reply", run: (c) => c.logReply({ commandId: "cmd", lead: LEAD, expectedRevision: 1 }) },
  {
    command: "book_appointment",
    run: (c) =>
      c.bookAppointment({
        commandId: "cmd",
        lead: LEAD,
        expectedRevision: 1,
        appointmentAt: "2026-09-20 10:00:00",
      }),
  },
  {
    command: "mark_outcome",
    run: (c) => c.markOutcome({ commandId: "cmd", lead: LEAD, expectedRevision: 1, outcome: "Won" }),
  },
  {
    command: "set_stage",
    run: (c) => c.setStage({ commandId: "cmd", lead: LEAD, expectedRevision: 1, stage: "Contacting" }),
  },
  {
    command: "set_quality",
    run: (c) => c.setQuality({ commandId: "cmd", lead: LEAD, expectedRevision: 1, quality: "valid" }),
  },
  { command: "create_note", run: (c) => c.createNote({ commandId: "cmd", lead: LEAD, content: "Called" }) },
  { command: "create_task", run: (c) => c.createTask({ commandId: "cmd", lead: LEAD, title: "Call back" }) },
  { command: "complete_task", run: (c) => c.completeTask({ commandId: "cmd", task: TASK }) },
  {
    command: "snooze_task",
    run: (c) => c.snoozeTask({ commandId: "cmd", task: TASK, dueAt: "2026-09-21 09:00:00" }),
  },
  {
    command: "reassign",
    run: (c) => c.reassign({ commandId: "cmd", lead: LEAD, expectedRevision: 1, assignee: "agent@example.com" }),
  },
  { command: "archive", run: (c) => c.archive({ commandId: "cmd", lead: LEAD, expectedRevision: 1 }) },
  {
    command: "reopen",
    run: (c) =>
      c.reopen({ commandId: "cmd", lead: LEAD, expectedRevision: 1, stage: "New", reason: "Called back" }),
  },
  { command: "record_event", run: (c) => c.recordEvent({ commandId: "cmd", lead: LEAD, type: "call_requested" }) },
];

/**
 * Commands that overwrite enquiry-level state. `api.py` refuses these without
 * an `expected_revision`, because two people editing the same enquiry is the
 * failure this guard exists for.
 */
const REQUIRES_REVISION = new Set([
  "log_contact",
  "log_reply",
  "book_appointment",
  "mark_outcome",
  "set_stage",
  "set_quality",
  "reassign",
  "archive",
  "reopen",
]);

test("every mutating command names the workspace and carries a command id", async () => {
  for (const { command, run } of MUTATIONS) {
    const { commands, calls } = build();
    await run(commands);

    assert.equal(calls.length, 1, `${command} should make exactly one call`);
    assert.equal(calls[0].method, `blockwise_crm.api.${command}`);
    assert.equal(calls[0].payload?.workspace_id, WORKSPACE, `${command} must scope to the workspace`);
    assert.equal(calls[0].payload?.command_id, "cmd", `${command} must carry a command id`);
  }
});

test("commands that overwrite enquiry state send the revision they expect", async () => {
  for (const { command, run } of MUTATIONS) {
    if (!REQUIRES_REVISION.has(command)) continue;
    const { commands, calls } = build();
    await run(commands);
    assert.equal(
      calls[0].payload?.expected_revision,
      1,
      `${command} must send expected_revision or the server refuses it`,
    );
  }
});

test("a capture carries the scoped source and the backfill flag", async () => {
  const { commands, calls } = build({
    call: { lead: LEAD, created: true, stage: "New", revision: 0 },
  });

  const result = await commands.captureEnquiry({
    commandId: "cmd",
    sourceProvider: "facebook",
    sourceSubmissionId: "sub-1",
    backfill: true,
  });

  assert.equal(calls[0].payload?.source_provider, "facebook");
  assert.equal(calls[0].payload?.source_submission_id, "sub-1");
  assert.equal(calls[0].payload?.backfill, true);
  assert.deepEqual(result, { lead: LEAD, created: true, stage: "New", revision: 0 });
});

test("a capture without backfill says so explicitly", async () => {
  const { commands, calls } = build();
  await commands.captureEnquiry({ commandId: "cmd", sourceProvider: "facebook", sourceSubmissionId: "sub-1" });
  assert.equal(calls[0].payload?.backfill, false);
});

test("the lead mapper reads the field names the API actually returns", async () => {
  const row = {
    name: LEAD,
    first_name: "Dana",
    last_name: "Nguyen",
    email: "dana@example.com",
    mobile_no: "0400000000",
    lead_owner: "agent@example.com",
    blockwise_stage: "Contacting",
    blockwise_quality: "high_intent",
    blockwise_archived: 0,
    blockwise_revision: 4,
    blockwise_source_provider: "facebook",
    blockwise_source_submission_id: "sub-1",
    blockwise_property_context: "Scarborough WA 6019",
    blockwise_received_at: "2026-09-13 05:00:00",
    modified: "2026-09-13 06:00:00",
  };

  const { commands } = build({ read: row });
  const lead = await commands.getLead(LEAD);

  assert.equal(lead.firstName, "Dana");
  assert.equal(lead.lastName, "Nguyen");
  assert.equal(lead.email, "dana@example.com");
  assert.equal(lead.phone, "0400000000");
  assert.equal(lead.owner, "agent@example.com");
  assert.equal(lead.stage, "Contacting");
  assert.equal(lead.quality, "high_intent");
  assert.equal(lead.archived, false);
  assert.equal(lead.revision, 4);
  assert.equal(lead.sourceProvider, "facebook");
  assert.equal(lead.sourceSubmissionId, "sub-1");
  assert.equal(lead.propertyContext, "Scarborough WA 6019");
  assert.equal(lead.receivedAt, "2026-09-13 05:00:00");
  assert.equal(lead.modified, "2026-09-13 06:00:00");
});

test("a task read prefers the native due date", async () => {
  const { commands } = build({
    read: {
      tasks: [
        {
          name: TASK,
          title: "Call back",
          status: "Todo",
          blockwise_purpose: "follow_up",
          blockwise_origin: "system",
          due_date: "2026-09-20 10:00:00",
          blockwise_due_at: null,
        },
      ],
    },
  });

  const tasks = await commands.listTasks();
  assert.equal(tasks.length, 1);
  const task = tasks[0];
  assert.ok(task, "one task expected");
  assert.equal(task.dueAt, "2026-09-20 10:00:00");
  assert.equal(task.purpose, "follow_up");
  assert.equal(task.origin, "system");
});

test("a legacy due date is still read when the native one is empty", async () => {
  const { commands } = build({
    read: {
      tasks: [
        {
          name: TASK,
          title: "Call back",
          status: "Todo",
          due_date: null,
          blockwise_due_at: "2026-09-19 09:00:00",
        },
      ],
    },
  });

  const tasks = await commands.listTasks();
  const task = tasks[0];
  assert.ok(task, "one task expected");
  assert.equal(task.dueAt, "2026-09-19 09:00:00");
});

test("quality is its own axis and can be cleared", async () => {
  const { commands, calls } = build();
  await commands.setQuality({ commandId: "cmd", lead: LEAD, expectedRevision: 2, quality: null });

  assert.equal(calls[0].payload?.quality, null);
  assert.equal(calls[0].payload?.expected_revision, 2);
});

test("a note is created with its content and the note name comes back", async () => {
  const { commands, calls } = build({ call: { lead: LEAD, note: "FCRM-NOTE-0001", revision: 5 } });
  const result = await commands.createNote({
    commandId: "cmd",
    lead: LEAD,
    content: "Called, no answer",
  });

  assert.equal(calls[0].payload?.content, "Called, no answer");
  assert.equal(calls[0].payload?.lead, LEAD);
  assert.equal(result.note, "FCRM-NOTE-0001");
});

test("notes are read for one enquiry with a bounded page", async () => {
  const { commands, calls } = build({
    read: {
      notes: [
        {
          name: "FCRM-NOTE-0001",
          title: "Note",
          content: "Called, no answer",
          owner: "agent@example.com",
          creation: "2026-09-13 06:00:00",
        },
      ],
    },
  });

  const notes = await commands.listNotes(LEAD, { limit: 10 });

  assert.equal(calls[0].method, "blockwise_crm.api.list_notes");
  assert.equal(calls[0].query?.workspace_id, WORKSPACE);
  assert.equal(calls[0].query?.lead, LEAD);
  assert.equal(calls[0].query?.limit, 10);
  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.content, "Called, no answer");
  assert.equal(notes[0]?.owner, "agent@example.com");
  assert.equal(notes[0]?.createdAt, "2026-09-13 06:00:00");
});

test("reads are asked for the workspace, so an unbound site shows up", async () => {
  const { commands, calls } = build({ call: { ok: true, site: SITE, workspace_id: WORKSPACE } });
  const result = await commands.health();

  assert.equal(calls[0].method, "blockwise_crm.api.health");
  assert.equal(calls[0].payload?.workspace_id, WORKSPACE);
  assert.deepEqual(result, { ok: true, site: SITE });
});

test("a command with no id is refused before it reaches the wire", async () => {
  const { commands, calls } = build();
  await assert.rejects(
    () => commands.completeTask({ commandId: "  ", task: TASK }),
    /command_id/,
    "an empty command id must not produce a request",
  );
  assert.equal(calls.length, 0);
});
