import assert from "node:assert/strict";
import test from "node:test";
import { fireLeadConvertedEvent, fireLeadRepliedEvent } from "../src/lib/email/lead-lifecycle.ts";

test("lead lifecycle events are durably recorded instead of silent no-ops", async () => {
  const events: Array<{ table: string; row: Record<string, unknown>; options: unknown }> = [];
  const supabase = {
    from(table: string) {
      return {
        upsert(row: Record<string, unknown>, options: unknown) {
          events.push({ table, row, options });
          return Promise.resolve({ error: null });
        },
      };
    },
  } as never;
  assert.deepEqual(await fireLeadRepliedEvent('person@example.com', 'lead-1', supabase), { recorded: true });
  assert.deepEqual(await fireLeadConvertedEvent('person@example.com', 'lead-1', supabase), { recorded: true });
  assert.deepEqual(events.map((event) => event.table), ['email_lifecycle_events', 'email_lifecycle_events']);
  assert.equal(events[0].row.event_type, 'lead.replied');
  assert.equal(events[1].row.event_type, 'lead.converted');
});
