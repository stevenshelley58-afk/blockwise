import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CrmCommands } from "../src/lib/crm/commands.ts";
import type { CrmLead } from "../src/lib/crm/types.ts";
import {
  LeadNoticeRecipientError,
  cancelObsoleteLeadNotices,
  normalizeNoticeEmail,
  produceNewLeadNotices,
  resolveNewLeadRecipients,
  resolveWorkspaceMemberRecipient,
} from "../src/lib/notifications/lead-notices.ts";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE = "22222222-2222-4222-8222-222222222222";

const AGENT = "agent@agency.test";
const OWNER = "owner@agency.test";
const LEAD_EMAIL = "buyer@gmail.test";

type Row = Record<string, unknown>;

const CONFLICT_KEYS: Record<string, string> = {
  email_outbox: "idempotency_key",
  lead_notice_records: "idempotency_key",
};

type FakeSupabase = SupabaseClient & {
  rows(table: string): Row[];
  updates: Array<{ table: string; patch: Row; matched: Row[] }>;
};

/**
 * Small in-memory Postgrest-shaped double: select/eq/in/or, upsert with
 * ignoreDuplicates on a declared conflict key, and update.
 */
function makeSupabase(seed: Record<string, Row[]>): FakeSupabase {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => ({ ...row }));
  const updates: Array<{ table: string; patch: Row; matched: Row[] }> = [];
  let counter = 0;

  function splitOr(expr: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of expr) {
      if (ch === "{") depth += 1;
      if (ch === "}") depth -= 1;
      if (ch === "," && depth === 0) {
        parts.push(current);
        current = "";
        continue;
      }
      current += ch;
    }
    if (current) parts.push(current);
    return parts;
  }

  function matchesOr(row: Row, expr: string): boolean {
    return splitOr(expr).some((part) => {
      const first = part.indexOf(".");
      if (first < 0) return false;
      const column = part.slice(0, first);
      const rest = part.slice(first + 1);
      const second = rest.indexOf(".");
      if (second < 0) return false;
      const op = rest.slice(0, second);
      const raw = rest.slice(second + 1).replace(/^\{/, "").replace(/\}$/, "");
      const value = row[column];
      if (op === "eq") return String(value ?? "") === raw;
      if (op === "cs") return Array.isArray(value) && value.map(String).includes(raw);
      return false;
    });
  }

  function makeBuilder(name: string) {
    const rows = (tables[name] ??= []);
    const filters: Array<{ op: string; column: string; value: unknown }> = [];
    let orExpr: string | null = null;
    let single = false;
    let mode: "select" | "upsert" | "insert" | "update" = "select";
    let pending: Row | Row[] | null = null;
    let patch: Row | null = null;
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } | undefined;

    const matches = (row: Row): boolean =>
      filters.every((filter) => {
        if (filter.op === "eq") return String(row[filter.column] ?? null) === String(filter.value ?? null);
        if (filter.op === "in") {
          const list = (filter.value as unknown[]) ?? [];
          return list.map(String).includes(String(row[filter.column] ?? null));
        }
        return true;
      }) && (orExpr === null || matchesOr(row, orExpr));

    const execute = (): { data: unknown; error: null } => {
      if (mode === "upsert" || mode === "insert") {
        const incoming = Array.isArray(pending) ? pending : [pending ?? {}];
        const written: Row[] = [];
        for (const row of incoming) {
          const conflictKey = CONFLICT_KEYS[name] ?? "id";
          const existing = rows.find(
            (candidate) => String(candidate[conflictKey] ?? null) === String(row[conflictKey] ?? null),
          );
          if (existing) {
            if (mode === "upsert" && upsertOpts?.ignoreDuplicates) continue;
            Object.assign(existing, row);
            written.push(existing);
            continue;
          }
          counter += 1;
          const created: Row = { ...row };
          if (created.id === undefined) created.id = name + "-" + counter;
          rows.push(created);
          written.push(created);
        }
        return { data: written, error: null };
      }

      if (mode === "update") {
        const matched = rows.filter(matches);
        for (const row of matched) Object.assign(row, patch ?? {});
        updates.push({ table: name, patch: patch ?? {}, matched: matched.map((row) => ({ ...row })) });
        return { data: matched, error: null };
      }

      const found = rows.filter(matches);
      const limited = found.slice(0, found.length);
      return { data: single ? (limited[0] ?? null) : limited, error: null };
    };

    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.order = () => builder;
    builder.limit = () => builder;
    builder.eq = (column: string, value: unknown) => {
      filters.push({ op: "eq", column, value });
      return builder;
    };
    builder.in = (column: string, value: unknown) => {
      filters.push({ op: "in", column, value });
      return builder;
    };
    builder.or = (expr: string) => {
      orExpr = expr;
      return builder;
    };
    builder.maybeSingle = () => {
      single = true;
      return builder;
    };
    builder.single = () => {
      single = true;
      return builder;
    };
    builder.upsert = (row: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
      mode = "upsert";
      pending = row;
      upsertOpts = opts;
      return builder;
    };
    builder.insert = (row: Row | Row[]) => {
      mode = "insert";
      pending = row;
      return builder;
    };
    builder.update = (value: Row) => {
      mode = "update";
      patch = value;
      return builder;
    };
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(execute()).then(resolve, reject);
    return builder;
  }

  const fake = {
    from: (name: string) => {
      const builder = makeBuilder(name);
      return { select: () => builder, upsert: builder.upsert, insert: builder.insert, update: builder.update };
    },
    rows: (name: string) => (tables[name] ??= []),
    updates,
  };
  return fake as unknown as FakeSupabase;
}

function memberSeed(): Record<string, Row[]> {
  return {
    workspace_members: [
      { workspace_id: WORKSPACE, profile_id: "p-agent", role: "member", profiles: { id: "p-agent", email: AGENT, full_name: "Ada Agent" } },
      { workspace_id: WORKSPACE, profile_id: "p-owner", role: "owner", profiles: { id: "p-owner", email: OWNER, full_name: "Olive Owner" } },
      { workspace_id: WORKSPACE, profile_id: "p-quiet", role: "admin", profiles: { id: "p-quiet", email: "quiet@agency.test", full_name: "Quinn Quiet", notification_preferences: { leadAlerts: false } } },
      { workspace_id: WORKSPACE, profile_id: "p-leadlike", role: "member", profiles: { id: "p-leadlike", email: LEAD_EMAIL, full_name: "Buyer Person" } },
      { workspace_id: OTHER_WORKSPACE, profile_id: "p-other", role: "owner", profiles: { id: "p-other", email: "other@agency.test", full_name: "Oscar Other" } },
    ],
    lead_notice_records: [],
    email_outbox: [],
  };
}

function makeCommands(lead: Partial<CrmLead> = {}, tasks: Row[] = []): CrmCommands {
  const full: CrmLead = {
    name: "CRM-LEAD-1",
    firstName: "Buyer",
    lastName: "Person",
    email: LEAD_EMAIL,
    phone: null,
    stage: "New",
    archived: false,
    owner: AGENT,
    revision: 1,
    sourceProvider: "meta",
    sourceSubmissionId: "sub-1",
    propertyContext: null,
    receivedAt: null,
    modified: null,
    ...lead,
  };
  return {
    getLead: async () => full,
    listTasks: async () => tasks,
  } as unknown as CrmCommands;
}

// ---------------------------------------------------------------------------

describe("lead notice recipients", () => {
  it("resolves a recipient from the workspace member record", async () => {
    const supabase = makeSupabase(memberSeed());
    const recipient = await resolveWorkspaceMemberRecipient(supabase, {
      workspaceId: WORKSPACE,
      profileId: "p-agent",
      forbiddenEmails: [LEAD_EMAIL],
    });
    assert.equal(recipient.email, AGENT);
    assert.equal(recipient.profileId, "p-agent");
  });

  it("rejects a member whose email is the lead contact address", async () => {
    const supabase = makeSupabase(memberSeed());
    await assert.rejects(
      () =>
        resolveWorkspaceMemberRecipient(supabase, {
          workspaceId: WORKSPACE,
          profileId: "p-leadlike",
          forbiddenEmails: [LEAD_EMAIL],
        }),
      LeadNoticeRecipientError,
    );
    await assert.rejects(
      () =>
        resolveWorkspaceMemberRecipient(supabase, {
          workspaceId: WORKSPACE,
          profileId: "p-leadlike",
          forbiddenEmails: [LEAD_EMAIL],
        }),
      /must never be a notice recipient/,
    );
  });

  it("rejects a lead contact address regardless of casing", async () => {
    const supabase = makeSupabase(memberSeed());
    await assert.rejects(
      () =>
        resolveWorkspaceMemberRecipient(supabase, {
          workspaceId: WORKSPACE,
          profileId: "p-leadlike",
          forbiddenEmails: [LEAD_EMAIL.toUpperCase()],
        }),
      /must never be a notice recipient/,
    );
    assert.equal(normalizeNoticeEmail("  Buyer@Gmail.Test "), LEAD_EMAIL);
  });

  it("rejects a profile that is not a member of this workspace", async () => {
    const supabase = makeSupabase(memberSeed());
    await assert.rejects(
      () =>
        resolveWorkspaceMemberRecipient(supabase, { workspaceId: WORKSPACE, profileId: "p-other" }),
      /not a member of this workspace/,
    );
  });

  it("never returns a lead address as a new-lead recipient", async () => {
    const supabase = makeSupabase(memberSeed());
    const recipients = await resolveNewLeadRecipients(supabase, {
      workspaceId: WORKSPACE,
      crmOwner: LEAD_EMAIL,
      leadEmails: [LEAD_EMAIL],
    });

    const emails = recipients.map((recipient) => recipient.email);
    assert.deepEqual(emails, [OWNER]);
    for (const email of emails) {
      assert.notEqual(normalizeNoticeEmail(email), LEAD_EMAIL);
    }
  });

  it("skips a member who has turned lead alerts off", async () => {
    const supabase = makeSupabase(memberSeed());
    const recipients = await resolveNewLeadRecipients(supabase, {
      workspaceId: WORKSPACE,
      crmOwner: "quiet@agency.test",
      leadEmails: [],
    });
    const emails = recipients.map((recipient) => recipient.email);
    assert.ok(emails.includes(OWNER), "the workspace owner is still notified");
    assert.ok(!emails.includes("quiet@agency.test"), "an opted-out member is skipped");
  });
});

describe("lead notice production", () => {
  it("queues a new-lead notice to the member, never to the lead", async () => {
    const supabase = makeSupabase(memberSeed());
    const results = await produceNewLeadNotices({
      supabase,
      commands: makeCommands(),
      workspaceId: WORKSPACE,
      enquiry: "CRM-LEAD-1",
      recipientProfileIds: ["p-owner"],
    });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.status, "queued");
    const outbox = supabase.rows("email_outbox");
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0]?.recipient, OWNER);
    assert.notEqual(outbox[0]?.recipient, LEAD_EMAIL);

    const payload = outbox[0]?.payload as Record<string, unknown>;
    assert.equal(payload.subject, "New enquiry waiting in Blockwise");
    const text = String(payload.text ?? "");
    assert.ok(!text.includes(LEAD_EMAIL), "the notice must not carry contact details");
    assert.ok(text.includes("http"), "the notice carries an authenticated link instead");
  });

  it("is idempotent for the same workspace, enquiry, recipient and kind", async () => {
    const supabase = makeSupabase(memberSeed());
    const input = {
      supabase,
      commands: makeCommands(),
      workspaceId: WORKSPACE,
      enquiry: "CRM-LEAD-1",
      recipientProfileIds: ["p-owner"],
    };
    const first = await produceNewLeadNotices(input);
    const second = await produceNewLeadNotices(input);

    assert.equal(first[0]?.status, "queued");
    assert.equal(second[0]?.status, "duplicate");
    assert.equal(supabase.rows("email_outbox").length, 1, "the outbox key collapses the replay");
  });

  it("produces nothing at all for a backfill", async () => {
    const supabase = makeSupabase(memberSeed());
    const results = await produceNewLeadNotices({
      supabase,
      commands: makeCommands(),
      workspaceId: WORKSPACE,
      enquiry: "CRM-LEAD-1",
      recipientProfileIds: ["p-owner"],
      backfill: true,
    });
    assert.deepEqual(results, []);
    assert.equal(supabase.rows("lead_notice_records").length, 0);
    assert.equal(supabase.rows("email_outbox").length, 0);
  });

  it("produces nothing once the enquiry is at a terminal stage", async () => {
    const supabase = makeSupabase(memberSeed());
    const results = await produceNewLeadNotices({
      supabase,
      commands: makeCommands({ stage: "Won" }),
      workspaceId: WORKSPACE,
      enquiry: "CRM-LEAD-1",
      recipientProfileIds: ["p-owner"],
    });
    assert.deepEqual(results, []);
    assert.equal(supabase.rows("email_outbox").length, 0);
  });
});

describe("obsolete notice cancellation", () => {
  function seedNotices(): Record<string, Row[]> {
    return {
      lead_notice_records: [
        {
          id: "n-1",
          workspace_id: WORKSPACE,
          idempotency_key: "lead-notice:" + WORKSPACE + ":CRM-LEAD-1:p-agent:new_lead",
          kind: "new_lead",
          status: "pending",
          outbox_idempotency_key: "lead-notice:" + WORKSPACE + ":CRM-LEAD-1:p-agent:new_lead",
          enquiry: "CRM-LEAD-1",
          task: null,
          task_keys: [],
        },
        {
          id: "n-2",
          workspace_id: WORKSPACE,
          idempotency_key: "lead-notice:" + WORKSPACE + ":p-agent:2026-09-08:follow_up_due_digest",
          kind: "follow_up_due_digest",
          status: "pending",
          outbox_idempotency_key: "lead-notice:" + WORKSPACE + ":p-agent:2026-09-08:follow_up_due_digest",
          enquiry: null,
          local_date: "2026-09-08",
          task: null,
          task_keys: ["TASK-9"],
        },
        {
          id: "n-3",
          workspace_id: WORKSPACE,
          idempotency_key: "lead-notice:" + WORKSPACE + ":CRM-LEAD-2:p-agent:new_lead",
          kind: "new_lead",
          status: "pending",
          outbox_idempotency_key: "lead-notice:" + WORKSPACE + ":CRM-LEAD-2:p-agent:new_lead",
          enquiry: "CRM-LEAD-2",
          task: null,
          task_keys: [],
        },
      ],
      email_outbox: [
        { id: "ob-1", idempotency_key: "lead-notice:" + WORKSPACE + ":CRM-LEAD-1:p-agent:new_lead", status: "pending", recipient: AGENT },
        { id: "ob-2", idempotency_key: "lead-notice:" + WORKSPACE + ":p-agent:2026-09-08:follow_up_due_digest", status: "pending", recipient: AGENT },
        { id: "ob-3", idempotency_key: "lead-notice:" + WORKSPACE + ":CRM-LEAD-2:p-agent:new_lead", status: "pending", recipient: AGENT },
      ],
    };
  }

  it("cancels the notices for one enquiry and suppresses the queued email", async () => {
    const supabase = makeSupabase(seedNotices());
    const result = await cancelObsoleteLeadNotices(supabase, {
      workspaceId: WORKSPACE,
      enquiry: "CRM-LEAD-1",
      reason: "task_completed",
    });

    assert.equal(result.cancelled, 1);
    const notices = supabase.rows("lead_notice_records");
    assert.equal(notices.find((row) => row.id === "n-1")?.status, "cancelled");
    assert.equal(notices.find((row) => row.id === "n-1")?.cancel_reason, "task_completed");
    assert.equal(notices.find((row) => row.id === "n-3")?.status, "pending", "other enquiries are untouched");

    const outbox = supabase.rows("email_outbox");
    assert.equal(outbox.find((row) => row.id === "ob-1")?.status, "suppressed");
    assert.equal(outbox.find((row) => row.id === "ob-3")?.status, "pending");
  });

  it("cancels a digest by task key after snooze, completion or reassignment", async () => {
    const supabase = makeSupabase(seedNotices());
    const result = await cancelObsoleteLeadNotices(supabase, {
      workspaceId: WORKSPACE,
      task: "TASK-9",
      reason: "task_snoozed",
    });

    assert.equal(result.cancelled, 1);
    const notices = supabase.rows("lead_notice_records");
    assert.equal(notices.find((row) => row.id === "n-2")?.status, "cancelled");
    const outbox = supabase.rows("email_outbox");
    assert.equal(outbox.find((row) => row.id === "ob-2")?.status, "suppressed");
  });

  it("does nothing without an enquiry or a task", async () => {
    const supabase = makeSupabase(seedNotices());
    const result = await cancelObsoleteLeadNotices(supabase, { workspaceId: WORKSPACE, reason: "whatever" });
    assert.equal(result.cancelled, 0);
    assert.deepEqual(supabase.updates, []);
  });

  it("does not cancel notices belonging to another workspace", async () => {
    const seed = seedNotices();
    for (const row of seed.lead_notice_records ?? []) row.workspace_id = OTHER_WORKSPACE;
    const supabase = makeSupabase(seed);
    const result = await cancelObsoleteLeadNotices(supabase, {
      workspaceId: WORKSPACE,
      enquiry: "CRM-LEAD-1",
      reason: "terminal_stage",
    });
    assert.equal(result.cancelled, 0);
    assert.deepEqual(supabase.updates, []);
  });
});
