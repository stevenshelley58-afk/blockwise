import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PROGRESSIVE_FUNNEL_EVENT_NAMES,
  recordProgressiveFunnelEvent,
  recordProgressiveFunnelEventBestEffort,
} from "../src/lib/analytics/progressive-funnel.ts";

const migration = "supabase/migrations/20260727028000_progressive_funnel_analytics.sql";

test("progressive funnel migration is service-role-only and matches the typed contract", () => {
  const sql = readFileSync(migration, "utf8");

  assert.match(sql, /create table if not exists public\.progressive_funnel_events/i);
  assert.match(sql, /alter table public\.progressive_funnel_events enable row level security/i);
  assert.match(
    sql,
    /revoke all on table public\.progressive_funnel_events from public, anon, authenticated/i,
  );
  assert.match(
    sql,
    /grant select, insert, update, delete on table public\.progressive_funnel_events to service_role/i,
  );
  assert.doesNotMatch(sql, /create policy/i);

  for (const name of PROGRESSIVE_FUNNEL_EVENT_NAMES) {
    assert.match(sql, new RegExp(`'${name}'`));
  }
  assert.match(sql, /workspace_id uuid references public\.workspaces\(id\) on delete cascade/i);
  assert.match(sql, /country_code text check \(country_code is null or country_code in \('US', 'AU'\)\)/i);
  assert.match(sql, /acquisition_source text not null/i);
  assert.match(sql, /idempotency_key text not null unique/i);
});

test("writer persists normalized server-confirmed event context idempotently", async () => {
  const writes: Array<{
    table: string;
    row: Record<string, unknown>;
    options: Record<string, unknown>;
  }> = [];
  const service = {
    from(table: string) {
      return {
        async upsert(row: Record<string, unknown>, options: Record<string, unknown>) {
          writes.push({ table, row, options });
          return { error: null };
        },
      };
    },
  };

  await recordProgressiveFunnelEvent(service as never, {
    eventName: "website_submitted",
    workspaceId: "workspace-123",
    country: "AU",
    acquisitionSource: " meta-campaign-42 ",
    idempotencyKey: "activation:workspace-123:website:v1",
    occurredAt: new Date("2026-07-27T08:00:00.000Z"),
    properties: { attempt: 1, resumed: false },
  });

  assert.deepEqual(writes, [
    {
      table: "progressive_funnel_events",
      row: {
        event_name: "website_submitted",
        event_domain: "activation",
        workspace_id: "workspace-123",
        country_code: "AU",
        acquisition_source: "meta-campaign-42",
        idempotency_key: "activation:workspace-123:website:v1",
        occurred_at: "2026-07-27T08:00:00.000Z",
        properties: { attempt: 1, resumed: false },
      },
      options: { onConflict: "idempotency_key", ignoreDuplicates: true },
    },
  ]);
});

test("writer rejects customer data in idempotency keys and unbounded properties", async () => {
  const service = {
    from() {
      return {
        async upsert() {
          return { error: null };
        },
      };
    },
  };

  await assert.rejects(
    recordProgressiveFunnelEvent(service as never, {
      eventName: "email_submitted",
      workspaceId: null,
      country: null,
      acquisitionSource: "direct",
      idempotencyKey: "person@example.com",
    }),
    /must be opaque/i,
  );

  await assert.rejects(
    recordProgressiveFunnelEvent(service as never, {
      eventName: "meta_connected",
      workspaceId: "workspace-123",
      country: "US",
      acquisitionSource: "direct",
      idempotencyKey: "meta:connection:123",
      properties: { token: "x".repeat(513) },
    }),
    /too long/i,
  );
});

test("writer surfaces persistence failures to the owning transaction", async () => {
  const service = {
    from() {
      return {
        async upsert() {
          return { error: { message: "database unavailable" } };
        },
      };
    },
  };

  await assert.rejects(
    recordProgressiveFunnelEvent(service as never, {
      eventName: "first_invoice_paid",
      workspaceId: "workspace-123",
      country: "US",
      acquisitionSource: "direct",
      idempotencyKey: "stripe:event:evt_123",
    }),
    /database unavailable/i,
  );
});

test("best-effort writer never changes the owning transaction outcome", async () => {
  const service = {
    from() {
      return {
        async upsert() {
          return { error: { message: "analytics unavailable" } };
        },
      };
    },
  };
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const recorded = await recordProgressiveFunnelEventBestEffort(service as never, {
      eventName: "email_verified",
      workspaceId: "workspace-123",
      country: "AU",
      acquisitionSource: "direct",
      idempotencyKey: "auth:verified:user-123:workspace-123",
    });
    assert.equal(recorded, false);
  } finally {
    console.error = originalError;
  }
});

test("owning server transactions emit authoritative funnel events with stable keys", () => {
  const sources = {
    auth: readFileSync("src/app/auth/confirm/route.ts", "utf8"),
    website: readFileSync("src/app/api/adstudio/brand-kits/extract/route.ts", "utf8"),
    brand: readFileSync("src/app/api/adstudio/brand-kits/[id]/approve/route.ts", "utf8"),
    generation: readFileSync("src/app/api/adstudio/campaigns/route.ts", "utf8"),
    generationWorker: readFileSync("worker/index.ts", "utf8"),
    meta: readFileSync("src/app/api/integrations/meta/callback/route.ts", "utf8"),
    metaHelp: readFileSync("src/app/api/integrations/meta/help/route.ts", "utf8"),
    metaPublish: readFileSync("src/lib/providers/meta-publish-worker.ts", "utf8"),
    checkout: readFileSync("src/app/api/settings/billing/checkout/route.ts", "utf8"),
    billing: readFileSync("src/app/api/settings/billing/webhook/route.ts", "utf8"),
    booking: readFileSync("src/lib/booking/service.ts", "utf8"),
  };

  assert.match(sources.auth, /recordProgressiveFunnelEventBestEffort/);
  assert.match(sources.auth, /eventName:\s*"email_verified"/);
  assert.match(sources.auth, /country:\s*null/);
  assert.match(sources.auth, /auth:verified:\$\{user\.id\}/);
  assert.match(sources.website, /eventName:\s*"website_submitted"/);
  assert.match(sources.brand, /eventName:\s*"brand_pack_approved"/);
  assert.match(sources.brand, /first-brand-pack-approved/);

  assert.match(sources.generation, /eventName:\s*"template_selected"/);
  assert.match(sources.generation, /eventName:\s*"first_generation_started"/);
  assert.match(sources.generation, /first-generation-started/);
  assert.doesNotMatch(sources.generation, /eventName:\s*"first_generation_completed"/);
  assert.match(sources.generationWorker, /eventName:\s*"first_generation_completed"/);

  assert.match(sources.meta, /eventName:\s*"meta_connected"/);
  assert.match(sources.metaHelp, /eventName:\s*"meta_help_requested"/);
  assert.match(sources.metaPublish, /eventName:\s*"free_campaign_launched"/);
  assert.match(sources.metaPublish, /free-campaign:\$\{consumption\.claimId\}/);

  assert.match(sources.checkout, /eventName:\s*"checkout_started"/);
  for (const eventName of [
    "checkout_completed",
    "managed_checkout",
    "first_invoice_paid",
    "first_renewal_paid",
    "payment_failed",
    "cancellation",
  ]) {
    assert.match(sources.billing, new RegExp(`"${eventName}"`));
  }
  assert.match(sources.billing, /billingFunnelIdempotencyKey/);
  assert.match(sources.billing, /amountPaid <= 0/);

  assert.match(sources.booking, /eventName:\s*"onboarding_booked"/);
  assert.match(sources.booking, /eventName:\s*"onboarding_completed"/);

  for (const [owner, source] of Object.entries(sources)) {
    if (owner === "auth") continue;
    assert.match(source, /recordWorkspaceFunnelEventBestEffort/);
  }
});
