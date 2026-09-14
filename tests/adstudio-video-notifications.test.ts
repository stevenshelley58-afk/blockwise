import assert from "node:assert/strict";
import test from "node:test";
import {
  VIDEO_NOTIFICATION_TRIGGERS,
  enqueueVideoNotification,
  type VideoNotificationKind,
} from "../src/lib/adstudio/video-notifications.ts";

/**
 * Captures what would be queued, so the assertions are about the real message
 * body rather than about the module's source text.
 */
function captureOutbox() {
  const queued: Array<Record<string, unknown>> = [];
  let duplicate = false;

  const supabase = {
    from(table: string) {
      if (table !== "email_outbox") throw new Error(`unexpected table ${table}`);
      return {
        upsert: (row: Record<string, unknown>) => {
          void row;
          return {
            select: async () => {
              if (duplicate) return { data: [], error: null };
              queued.push(row);
              return { data: [{ id: `outbox-${queued.length}` }], error: null };
            },
          };
        },
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: duplicate ? { id: "existing" } : null }) }),
        }),
      };
    },
  } as never;

  return {
    supabase,
    queued,
    setDuplicate: (value: boolean) => {
      duplicate = value;
    },
  };
}

const ORDER = {
  workspaceId: "aaaaaaaa-0000-4000-8000-00000000000a",
  orderId: "b0000000-0000-4000-8000-0000000000b1",
  projectTitle: "Front of house walkthrough",
  firstDraftDueAt: "2026-09-16T07:00:00.000Z",
  dueTimezone: "Australia/Sydney",
  revisionEntitlement: 1,
  revisionsUsed: 0,
};

const KINDS: VideoNotificationKind[] = ["order_confirmed", "draft_ready", "revision_received", "final_ready"];

test("every notification is queued with a subject, html and text", async () => {
  for (const kind of KINDS) {
    const outbox = captureOutbox();
    const result = await enqueueVideoNotification({
      supabase: outbox.supabase,
      kind,
      to: "customer@example.com",
      order: ORDER,
      versionNumber: 1,
    });
    assert.equal(result.queued, true, `${kind} must queue`);
    assert.equal(outbox.queued.length, 1);

    const payload = outbox.queued[0].payload as Record<string, unknown>;
    assert.ok(String(payload.subject).length > 5, `${kind} needs a real subject`);
    assert.match(String(payload.html), /<!doctype html>/i);
    assert.ok(String(payload.text).length > 40, `${kind} needs a readable text body`);
  }
});

test("no message carries a media path, a storage reference or a signed link", async () => {
  for (const kind of KINDS) {
    const outbox = captureOutbox();
    await enqueueVideoNotification({
      supabase: outbox.supabase,
      kind,
      to: "customer@example.com",
      order: ORDER,
      versionNumber: 2,
    });

    const serialised = JSON.stringify(outbox.queued[0]);
    // A signed link in an inbox is a bearer credential that outlives the
    // authorisation that produced it, so none may appear in a message.
    for (const forbidden of [
      "adstudio-video",
      "/storage/v1/",
      "token=",
      "signed",
      "X-Amz-Signature",
      "object_path",
      "objectPath",
      "production_source",
    ]) {
      assert.ok(
        !serialised.toLowerCase().includes(forbidden.toLowerCase()),
        `${kind} must not contain "${forbidden}"`,
      );
    }
  }
});

test("every message links to the authenticated surface instead", async () => {
  for (const kind of KINDS) {
    const outbox = captureOutbox();
    await enqueueVideoNotification({ supabase: outbox.supabase, kind, to: "c@example.com", order: ORDER });
    const payload = outbox.queued[0].payload as Record<string, unknown>;
    assert.match(String(payload.html), /\/ad-studio\/video/, `${kind} must link to the video page`);
    assert.match(String(payload.text), /\/ad-studio\/video/);
  }
});

test("the customer's reply goes to the published support address", async () => {
  const outbox = captureOutbox();
  await enqueueVideoNotification({ supabase: outbox.supabase, kind: "draft_ready", to: "c@example.com", order: ORDER });
  const payload = outbox.queued[0].payload as Record<string, unknown>;
  assert.equal(payload.replyTo, "support@blockwise.sale");
});

test("a retried event does not send a second message", async () => {
  const outbox = captureOutbox();
  outbox.setDuplicate(true);
  const result = await enqueueVideoNotification({
    supabase: outbox.supabase,
    kind: "order_confirmed",
    to: "c@example.com",
    order: ORDER,
  });
  assert.equal(result.queued, false, "a duplicate must be reported as already sent");
  assert.equal(outbox.queued.length, 0, "nothing new may be enqueued");
});

test("idempotency is scoped to the order and the version", async () => {
  const keys = new Set<string>();
  for (const versionNumber of [1, 2]) {
    const outbox = captureOutbox();
    await enqueueVideoNotification({
      supabase: outbox.supabase,
      kind: "draft_ready",
      to: "c@example.com",
      order: ORDER,
      versionNumber,
    });
    keys.add(String(outbox.queued[0].idempotency_key));
  }
  // A revised draft is a new event and must be allowed to notify again.
  assert.equal(keys.size, 2, "each version needs its own idempotency key");

  const single = captureOutbox();
  await enqueueVideoNotification({ supabase: single.supabase, kind: "draft_ready", to: "c@example.com", order: ORDER });
  const other = captureOutbox();
  await enqueueVideoNotification({
    supabase: other.supabase,
    kind: "draft_ready",
    to: "c@example.com",
    order: { ...ORDER, orderId: "b0000000-0000-4000-8000-0000000000b2" },
  });
  assert.notEqual(
    single.queued[0].idempotency_key,
    other.queued[0].idempotency_key,
    "distinct orders are distinct",
  );
});

test("an invalid recipient is refused rather than queued", async () => {
  const outbox = captureOutbox();
  await assert.rejects(
    () => enqueueVideoNotification({ supabase: outbox.supabase, kind: "final_ready", to: "not-an-address", order: ORDER }),
  );
  assert.equal(outbox.queued.length, 0);
});

test("the order confirmation states the committed deadline", async () => {
  const outbox = captureOutbox();
  await enqueueVideoNotification({ supabase: outbox.supabase, kind: "order_confirmed", to: "c@example.com", order: ORDER });
  const text = String((outbox.queued[0].payload as Record<string, unknown>).text);
  // The exact local date and time, never a duration the customer must interpret.
  assert.match(text, /draft is due/i);
  assert.match(text, /Sep|17:00|5:00/, `expected a concrete date, got: ${text.slice(0, 200)}`);
  assert.doesNotMatch(text, /48 hours/i, "a duration is what the customer misreads");
});

test("each notification names the trigger it is raised from", () => {
  for (const kind of KINDS) {
    assert.ok(VIDEO_NOTIFICATION_TRIGGERS[kind].length > 10, `${kind} needs a recorded trigger`);
  }
  // Confirmation comes from verified payment, never from a redirect.
  assert.match(VIDEO_NOTIFICATION_TRIGGERS.order_confirmed, /webhook/);
  assert.match(VIDEO_NOTIFICATION_TRIGGERS.order_confirmed, /not the success redirect/);
});
