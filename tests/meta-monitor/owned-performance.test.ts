import assert from "node:assert/strict";
import test from "node:test";

import { persistOwnedAdPerformanceFromMonitor } from "../../src/lib/meta-monitor/owned-performance.ts";
import type { MetaMonitorPayload } from "../../src/lib/meta-monitor/types.ts";

test("persistOwnedAdPerformanceFromMonitor upserts only tagged live ads", async () => {
  let rows: unknown[] = [];
  let conflictTarget: string | undefined;
  const serviceSupabase = {
    schema(schemaName: string) {
      assert.equal(schemaName, "research");
      return {
        from(tableName: string) {
          assert.equal(tableName, "owned_ad_performance");
          return {
            async upsert(inputRows: unknown[], options: { onConflict?: string }) {
              rows = inputRows;
              conflictTarget = options.onConflict;
              return { error: null };
            },
          };
        },
      };
    },
  };

  const payload = monitorPayload({
    ads: [
      {
        adId: "meta-1",
        adName: "Campaign ad | bw:v=variant1;a=market-update;t=MKT-42",
        campaignId: "campaign-1",
        campaignName: "Campaign",
        adsetId: "adset-1",
        adsetName: "Suburb - Perth",
        suburb: "Perth",
        status: "ACTIVE",
        landingPageUrl: null,
        metaPermalinkUrl: null,
        creative: {
          type: "IMAGE",
          thumbnailUrl: null,
          imageUrl: null,
          videoThumbnailUrl: null,
          primaryText: null,
          headline: null,
          description: null,
        },
        metrics: {
          spend: 123.45,
          impressions: 2000,
          clicks: 80,
          ctr: 0.04,
          leads: 12,
          validLeads: 9,
          validRate: 0.75,
          validCpl: 13.716,
          frequency: 1.5,
          landingPageViews: null,
        },
        variantTags: { variantId: "variant1", angle: "market-update", template: "MKT-42" },
        fatigued: false,
      },
      {
        adId: "meta-2",
        adName: "Untagged ad",
        campaignId: "campaign-1",
        campaignName: "Campaign",
        adsetId: "adset-1",
        adsetName: "Suburb - Perth",
        suburb: "Perth",
        status: "ACTIVE",
        landingPageUrl: null,
        metaPermalinkUrl: null,
        creative: {
          type: "IMAGE",
          thumbnailUrl: null,
          imageUrl: null,
          videoThumbnailUrl: null,
          primaryText: null,
          headline: null,
          description: null,
        },
        metrics: {
          spend: 10,
          impressions: 100,
          clicks: 1,
          ctr: 0.01,
          leads: 0,
          validLeads: 0,
          validRate: null,
          validCpl: null,
          frequency: null,
          landingPageViews: null,
        },
        variantTags: null,
      },
    ],
  });

  const result = await persistOwnedAdPerformanceFromMonitor({
    serviceSupabase: serviceSupabase as never,
    workspaceId: "workspace-1",
    payload,
    now: new Date("2026-06-15T03:04:05.000Z"),
  });

  assert.equal(result.considered, 2);
  assert.equal(result.persisted, 1);
  assert.equal(conflictTarget, "workspace_id,meta_ad_id,reported_at,source");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    workspace_id: "workspace-1",
    template_key: "MKT-42",
    meta_ad_id: "meta-1",
    meta_adset_id: "adset-1",
    meta_campaign_id: "campaign-1",
    impressions: 2000,
    clicks: 80,
    leads: 12,
    qualified_leads: 9,
    spend_cents: 12345,
    ctr: 0.04,
    cpl_cents: 1372,
    lead_quality_score: 75,
    reported_at: "2026-06-15T23:59:59.000Z",
    source: "meta_monitor",
    raw_metrics: {
      variant_id: "variant1",
      angle: "market-update",
      ad_name: "Campaign ad | bw:v=variant1;a=market-update;t=MKT-42",
      campaign_name: "Campaign",
      adset_name: "Suburb - Perth",
      suburb: "Perth",
      frequency: 1.5,
      fatigued: false,
    },
    updated_at: "2026-06-15T03:04:05.000Z",
  });
});

test("persistOwnedAdPerformanceFromMonitor skips sample payloads", async () => {
  const result = await persistOwnedAdPerformanceFromMonitor({
    serviceSupabase: {} as never,
    workspaceId: "workspace-1",
    payload: monitorPayload({ source: "sample" }),
  });

  assert.deepEqual(result, { considered: 0, persisted: 0 });
});

function monitorPayload(overrides: Partial<MetaMonitorPayload>): MetaMonitorPayload {
  return {
    connected: true,
    source: "live",
    currencyCode: "AUD",
    range: {
      key: "last_7",
      label: "Last 7 days",
      since: "2026-06-09",
      until: "2026-06-15",
      days: 7,
    },
    issue: null,
    summary: null,
    daily: [],
    suburbPerformance: [],
    ads: [],
    ...overrides,
  };
}
