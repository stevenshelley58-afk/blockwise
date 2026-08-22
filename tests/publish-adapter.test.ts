import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validatePublishState,
  PublishError,
  buildPausedMetaPublishPlan,
  activationTargets,
  assertActivationReadiness,
  planActivation,
  markPlanObjectsActive,
  activatePausedMetaPublish,
} from "../src/lib/adstudio/publish-adapter.ts";
import type { MetaPublishPlan } from "../src/lib/providers/meta-execution.ts";
import { encryptToken } from "../src/lib/providers/token-crypto.ts";
import type { TemplatePack } from "../packages/ad-template-pack-contract/src/types.ts";

const mockPack: TemplatePack = {
  schema: "blockwise.template-pack/v1",
  templateId: "test-001",
  version: 1,
  packId: "pack-test-001-v1",
  createdAt: new Date().toISOString(),
  builderVersion: "v1",
  rendererVersion: "v1",
  classification: { label: "test", modelVersion: "v1", confidence: 0.9 },
  manifestSha256: "0".repeat(64),
  signature: "sig",
  feedLayout: { placement: "feed", layers: [], safeZones: [] },
  storyLayout: { placement: "story", layers: [], safeZones: [] },
  imageInputs: [],
  textInputs: [],
  semanticColours: { background: "#FFF", primary: "#00F", secondary: "#666", accent: "#F90", mainText: "#111", inverseText: "#FFF" },
  assets: {},
  fonts: [],
  safePreviews: { feed: { sha256: "f".repeat(64) }, story: { sha256: "f".repeat(64) } },
  qaEvidence: { feedPassed: true, storyPassed: true, reviewerVersions: ["v1"], stressFixtureResults: {} },
};

const validState = {
  ad: {
    id: "ad-001",
    templatePackId: "pack-test-001-v1",
    colourMode: "template" as const,
    metaPrimaryText: "Primary text",
    metaHeadline: "Headline",
    metaDescription: "Description",
    metaCta: "LEARN_MORE",
  },
  revision: {
    id: "rev-001",
    revisionNumber: 1,
    documentHash: "abc123",
    feedPngHash: "feed-hash",
    feedPngPath: "feeds/test.png",
    storyPngHash: "story-hash",
    storyPngPath: "stories/test.png",
  },
  pack: mockPack,
  form: {
    name: "Test Form",
    formType: "more_volume" as const,
    intro: { headline: "Hi", body: "Hello" },
    contactFields: [{ type: "email" as const, required: true }, { type: "full_name" as const, required: true }],
    customQuestions: [],
    privacy: { url: "https://example.com/privacy", linkText: "Privacy" },
    thankYou: { title: "Thanks", body: "Done", actionType: "visit_website" as const, actionUrl: "https://example.com/article" },
  },
  formDraftId: "form-draft-001",
  formRevision: 1,
};

describe("Publish adapter", () => {
  it("validates complete state", () => {
    const issues = validatePublishState(validState, { controls: { destinationUrl: "https://example.com/article" } });
    assert.equal(issues.length, 0, JSON.stringify(issues));
  });

  it("does not invent a website dependency for an Instant Form pack", () => {
    const issues = validatePublishState(validState, { controls: { destinationMode: "instant_form" } });
    assert.deepEqual(issues, []);
  });

  it("detects missing Feed PNG", () => {
    const s = structuredClone(validState);
    s.revision.feedPngHash = "";
    assert.ok(validatePublishState(s).some(i => i.includes("Feed PNG")));
  });

  it("detects missing Story PNG", () => {
    const s = structuredClone(validState);
    s.revision.storyPngHash = "";
    assert.ok(validatePublishState(s).some(i => i.includes("Story PNG")));
  });

  it("detects missing primary text", () => {
    const s = structuredClone(validState);
    s.ad.metaPrimaryText = "";
    assert.ok(validatePublishState(s).some(i => i.includes("primary text")));
  });

  it("detects missing headline", () => {
    const s = structuredClone(validState);
    s.ad.metaHeadline = "";
    assert.ok(validatePublishState(s).some(i => i.includes("headline")));
  });

  it("detects missing CTA", () => {
    const s = structuredClone(validState);
    s.ad.metaCta = "";
    assert.ok(validatePublishState(s).some(i => i.includes("CTA")));
  });

  it("detects missing form", () => {
    const s = structuredClone(validState);
    (s as any).form = null;
    assert.ok(validatePublishState(s).some(i => i.includes("Instant Form")));
  });

  it("PublishError has code and message", () => {
    const err = new PublishError("not_saved", "Save first");
    assert.equal(err.code, "not_saved");
    assert.equal(err.message, "Save first");
  });
});

// ---------------------------------------------------------------------------
// BW-M — paused publish plan builder
// ---------------------------------------------------------------------------

const mockSetup = {
  metaAdAccountId: "act_123",
  pageId: "page_456",
  instagramActorId: null,
  pixelId: null,
  leadDestination: { type: "manual" as const, label: "Manual review" },
  privacyPolicyUrl: "https://example.com/privacy",
  currency: "AUD",
  timezone: "Australia/Perth",
};
const mockControls = { destinationUrl: "https://example.com/article", destinationMode: "instant_form" as const };

describe("buildPausedMetaPublishPlan", () => {
  const plan = buildPausedMetaPublishPlan({
    adId: "ad-001",
    workspaceId: "ws-001",
    connectionId: "conn-001",
    setup: mockSetup,
    controls: mockControls,
    state: validState,
  });

  it("creates a campaign PAUSED with housing category", () => {
    assert.equal(plan.campaign.status, "PAUSED");
    assert.equal(plan.campaign.objective, "OUTCOME_LEADS");
    assert.deepEqual(plan.campaign.specialAdCategories, ["HOUSING"]);
  });

  it("creates one ad set PAUSED", () => {
    assert.equal(plan.adSets.length, 1);
    assert.equal(plan.adSets[0]!.status, "PAUSED");
    assert.equal(plan.adSets[0]!.campaignLocalId, "campaign_main");
    assert.equal(plan.adSets[0]!.dailyBudgetMinorUnits, 2000);
  });

  it("creates a lead form from the Instant Form", () => {
    assert.equal(plan.leadForms.length, 1);
    assert.equal(plan.leadForms[0]!.privacyPolicyUrl, mockSetup.privacyPolicyUrl);
    assert.ok(plan.leadForms[0]!.headline.length > 0);
  });

  it("creates feed + story creatives PAUSED referencing revision PNGs", () => {
    assert.equal(plan.creatives.length, 2);
    assert.deepEqual(plan.creatives.map(c => c.format).sort(), ["4:5", "9:16"]);
    for (const creative of plan.creatives) {
      assert.equal(creative.asset?.source, "storage");
      assert.ok(creative.asset?.storagePath);
    }
  });

  it("creates two ads PAUSED", () => {
    assert.equal(plan.ads.length, 2);
    for (const ad of plan.ads) {
      assert.equal(ad.status, "PAUSED");
    }
  });

  it("never reports live — plan status is draft and ads are PAUSED", () => {
    assert.equal(plan.status, "draft");
    assert.ok(!JSON.stringify(plan).toLowerCase().includes("live"));
  });

  it("is deterministic for the same frozen revision", () => {
    const again = buildPausedMetaPublishPlan({
      adId: "ad-001",
      workspaceId: "ws-001",
      connectionId: "conn-001",
    setup: mockSetup,
      controls: mockControls,
      state: validState,
    });
    assert.equal(plan.planId, again.planId);
    assert.equal(plan.idempotencyKey, again.idempotencyKey);
  });

  it("changes plan identity when the frozen revision changes", () => {
    const changed = structuredClone(validState);
    changed.revision.id = "rev-002";
    changed.revision.revisionNumber = 2;
    const again = buildPausedMetaPublishPlan({
      adId: "ad-001",
      workspaceId: "ws-001",
      connectionId: "conn-001",
    setup: mockSetup,
      controls: mockControls,
      state: changed,
    });
    assert.notEqual(plan.planId, again.planId);
  });

  it("refuses a publish when the pinned form is missing", () => {
    const noForm = structuredClone(validState);
    (noForm as any).form = null;
    assert.throws(() => buildPausedMetaPublishPlan({
      adId: "ad-001", workspaceId: "ws-001", connectionId: "conn-001", setup: mockSetup,
      controls: mockControls, state: noForm,
    }), /pinned Instant Form|publish_dependencies_missing/);
  });

  it("builds website mode without a lead form and never uses privacy as destination", () => {
    const websitePlan = buildPausedMetaPublishPlan({
      adId: "ad-website", workspaceId: "ws-001", connectionId: "conn-001", setup: mockSetup,
      controls: { destinationUrl: "https://example.com/article", destinationMode: "website" }, state: validState,
    });
    assert.equal(websitePlan.leadForms.length, 0);
    assert.equal(websitePlan.creatives[0]!.leadFormLocalId, "");
    assert.equal(websitePlan.controls.destinationUrl, "https://example.com/article");
  });

  it("refuses an invalid or absent destination instead of falling back to privacy", () => {
    assert.throws(() => buildPausedMetaPublishPlan({
      adId: "ad-no-destination", workspaceId: "ws-001", connectionId: "conn-001", setup: mockSetup,
      controls: { destinationMode: "website" }, state: validState,
    }), /destination URL|publish_dependencies_missing/);
    assert.throws(() => buildPausedMetaPublishPlan({
      adId: "ad-http", workspaceId: "ws-001", connectionId: "conn-001", setup: mockSetup,
      controls: { destinationUrl: "http://example.com/article", destinationMode: "website" }, state: validState,
    }), /destination URL|publish_dependencies_missing/);
  });

  it("honours the optional v2 publishRequirements CTA allow-list", () => {
    const restricted = structuredClone(validState);
    (restricted.pack as unknown as Record<string, unknown>).publishRequirements = {
      destinationMode: "website", requiredCtaTypes: ["SIGN_UP"],
    };
    assert.throws(() => buildPausedMetaPublishPlan({
      adId: "ad-cta", workspaceId: "ws-001", connectionId: "conn-001", setup: mockSetup,
      controls: { destinationUrl: "https://example.com/article", destinationMode: "website" }, state: restricted,
    }), /CTA must be one of/);
  });

  it("reads nested v2 metadata publish requirements", () => {
    const nested = structuredClone(validState);
    (nested.pack as unknown as Record<string, unknown>).metadata = {
      publishRequirements: {
        destination: { required: true, kind: "article", dependency: "article-1" },
        instantForm: { required: false, dependency: null },
      },
    };
    const issues = validatePublishState(nested, { controls: { destinationMode: "website", destinationUrl: "https://example.com/article" } });
    assert.deepEqual(issues, []);
  });
});

// ---------------------------------------------------------------------------
// BW-Q — explicit Activate after a PAUSED publish. Never auto-live.
// ---------------------------------------------------------------------------

function pausedPlan(): MetaPublishPlan {
  return {
    ...buildPausedMetaPublishPlan({
      adId: "ad-001",
      workspaceId: "ws-001",
      connectionId: "conn-001",
      setup: mockSetup,
      controls: mockControls,
      state: validState,
    }),
    status: "paused_live",
    reconciledObjects: {
      campaignId: "1001",
      leadFormIds: { form_primary: "9001" },
      adSetIds: { adset_primary: "1002" },
      creativeIds: { creative_feed: "8001", creative_story: "8002" },
      adIds: { ad_feed: "1003", ad_story: "1004" },
    },
  };
}

describe("activationTargets", () => {
  it("extracts the created Meta object IDs from a paused plan", () => {
    const targets = activationTargets(pausedPlan());
    assert.deepEqual(targets, {
      campaignId: "1001",
      adSetIds: ["1002"],
      adIds: ["1003", "1004"],
    });
  });

  it("returns null when no campaign was created on Meta", () => {
    const plan = pausedPlan();
    plan.reconciledObjects.campaignId = undefined;
    assert.equal(activationTargets(plan), null);
  });
});

describe("assertActivationReadiness", () => {
  it("refuses a draft plan — the publish was a dry run, nothing exists on Meta", () => {
    const plan = pausedPlan();
    plan.status = "draft";
    const readiness = assertActivationReadiness(plan);
    assert.equal(readiness.ok, false);
    if (!readiness.ok) {
      assert.equal(readiness.code, "never_created_on_meta");
      assert.match(readiness.message, /dry run/i);
    }
  });

  it("refuses a failed plan", () => {
    const plan = pausedPlan();
    plan.status = "failed";
    const readiness = assertActivationReadiness(plan);
    assert.equal(readiness.ok, false);
    if (!readiness.ok) assert.equal(readiness.code, "not_paused_on_meta");
  });

  it("refuses a paused_live plan with no object IDs", () => {
    const plan = pausedPlan();
    plan.reconciledObjects = {
      campaignId: undefined,
      leadFormIds: {},
      adSetIds: {},
      creativeIds: {},
      adIds: {},
    };
    const readiness = assertActivationReadiness(plan);
    assert.equal(readiness.ok, false);
    if (!readiness.ok) assert.equal(readiness.code, "not_paused_on_meta");
  });

  it("accepts a paused_live plan that created PAUSED objects", () => {
    const readiness = assertActivationReadiness(pausedPlan());
    assert.equal(readiness.ok, true);
    if (readiness.ok) assert.equal(readiness.targets.campaignId, "1001");
  });
});

describe("planActivation", () => {
  it("returns a dry-run receipt when provider writes are disabled — campaign stays PAUSED", () => {
    const planned = planActivation(pausedPlan(), { providerWritesEnabled: false });
    assert.equal(planned.mode, "dry_run");
    if (planned.mode === "dry_run") {
      assert.equal(planned.status, "paused");
      assert.match(planned.message, /NOT applied/i);
      assert.match(planned.message, /stays PAUSED on Meta/i);
      assert.ok(!planned.message.toLowerCase().includes("live"));
    }
  });

  it("builds an activate mutation when provider writes are enabled", () => {
    const planned = planActivation(pausedPlan(), { requestedBy: "user-1", providerWritesEnabled: true });
    assert.equal(planned.mode, "activate");
    if (planned.mode === "activate") {
      assert.equal(planned.status, "activated");
      assert.equal(planned.mutation.action, "activate");
      assert.equal(planned.mutation.planId, pausedPlan().planId);
      assert.deepEqual(planned.mutation.payload, {
        campaignId: "1001",
        adSetIds: ["1002"],
        adIds: ["1003", "1004"],
      });
      assert.match(planned.message, /Activated on Meta/i);
    }
  });

  it("never activates a dry-run (draft) publish — throws, does not invent live state", () => {
    const plan = pausedPlan();
    plan.status = "draft";
    assert.throws(
      () => planActivation(plan, { providerWritesEnabled: true }),
      (err: unknown) => err instanceof PublishError && err.code === "never_created_on_meta",
    );
  });
});

describe("markPlanObjectsActive", () => {
  it("records ACTIVE statuses for campaign, ad sets, and ads", () => {
    const marked = markPlanObjectsActive(pausedPlan());
    assert.equal(marked.reconciledObjects.objectStatuses?.campaign?.configuredStatus, "ACTIVE");
    assert.equal(marked.reconciledObjects.objectStatuses?.campaign?.id, "1001");
    assert.equal(marked.reconciledObjects.objectStatuses?.adSets?.["adset_primary"]?.configuredStatus, "ACTIVE");
    assert.equal(marked.reconciledObjects.objectStatuses?.ads?.["ad_feed"]?.configuredStatus, "ACTIVE");
    // The plan status stays paused_live — the create lifecycle never claims "live".
    assert.equal(marked.status, "paused_live");
  });
});

// ---------------------------------------------------------------------------
// Orchestrator — activatePausedMetaPublish against an in-memory fake Supabase.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

class FakeSupabase {
  tables: Record<string, Row[]> = {
    meta_publish_plans: [],
    meta_publish_plan_mutations: [],
    approval_requests: [],
    audit_logs: [],
  };
  rpcs: Record<string, (args: Record<string, unknown>) => { data: unknown; error: unknown }> = {};
  seq = 0;

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> {
    const handler = this.rpcs[name];
    if (!handler) {
      return Promise.resolve({ data: null, error: { message: `No fake rpc registered for ${name}` } });
    }
    return Promise.resolve(handler(args));
  }
}

class FakeQuery {
  private db: FakeSupabase;
  private table: string;
  private filters: Array<[string, unknown]> = [];
  private op: { kind: "insert" | "update"; value: Row } | null = null;
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;

  constructor(db: FakeSupabase, table: string) {
    this.db = db;
    this.table = table;
  }

  select(): this {
    return this;
  }

  eq(col: string, value: unknown): this {
    this.filters.push([col, value]);
    return this;
  }

  order(col: string, options: { ascending: boolean }): this {
    this.orderCol = col;
    this.orderAsc = options.ascending;
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  insert(value: Row): this {
    this.op = { kind: "insert", value };
    return this;
  }

  update(value: Row): this {
    this.op = { kind: "update", value };
    return this;
  }

  maybeSingle(): { data: Row | null; error: unknown } {
    if (this.op?.kind === "insert") return this.doInsert();
    const rows = this.rows();
    return { data: rows[0] ?? null, error: null };
  }

  single(): { data: Row | null; error: unknown } {
    if (this.op?.kind === "insert") return this.doInsert();
    const rows = this.rows();
    if (rows.length === 0) {
      return { data: null, error: { message: "No rows found", code: "PGRST116", details: "", hint: "" } };
    }
    return { data: rows[0], error: null };
  }

  /** Awaited insert/update chains apply their op (save-ad FakeQuery pattern). */
  then(resolve: (v: { data: Row | null; error: unknown }) => void): void {
    if (this.op?.kind === "update") {
      const targets = this.rows();
      for (const target of targets) Object.assign(target, this.op.value);
      resolve({ data: targets[0] ?? null, error: null });
      return;
    }
    if (this.op?.kind === "insert") {
      resolve(this.doInsert());
      return;
    }
    resolve(this.maybeSingle());
  }

  private doInsert(): { data: Row; error: null } {
    const row = this.op!.value;
    // Postgres auto-generates ids on tables without an explicit id — mirror
    // that so `.select("id").single()` after an insert returns a usable id.
    if (row.id === undefined) row.id = `id-${++this.db.seq}`;
    (this.db.tables[this.table] ??= []).push(row);
    return { data: row, error: null };
  }

  private rows(): Row[] {
    let rows = (this.db.tables[this.table] ?? []).filter(row =>
      this.filters.every(([col, value]) => row[col] === value),
    );
    if (this.orderCol) {
      rows = [...rows].sort((a, b) => {
        const av = a[this.orderCol!];
        const bv = b[this.orderCol!];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = av < bv ? -1 : 1;
        return this.orderAsc ? cmp : -cmp;
      });
    }
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    return rows;
  }
}

function planToRow(plan: MetaPublishPlan): Row {
  return {
    id: plan.planId,
    workspace_id: plan.workspaceId,
    adstudio_campaign_id: plan.adStudioCampaignId,
    adstudio_export_id: plan.adStudioExportId,
    campaign_id: plan.legacyCampaignId,
    provider_connection_id: plan.providerConnectionId,
    approval_request_id: plan.approvalRequestId,
    adapter: plan.adapter,
    status: plan.status,
    idempotency_key: plan.idempotencyKey,
    meta_ad_account_id: plan.setup.metaAdAccountId,
    page_id: plan.setup.pageId,
    instagram_actor_id: plan.setup.instagramActorId,
    pixel_id: plan.setup.pixelId,
    lead_destination_json: plan.setup.leadDestination,
    privacy_policy_url: plan.setup.privacyPolicyUrl,
    currency: plan.setup.currency,
    timezone: plan.setup.timezone,
    plan_json: {
      campaign: plan.campaign,
      adSets: plan.adSets,
      leadForms: plan.leadForms,
      creatives: plan.creatives,
      ads: plan.ads,
      tracking: plan.tracking,
      controls: plan.controls,
    },
    request_log_json: plan.requestLog,
    response_log_json: plan.responseLog,
    reconciled_objects_json: plan.reconciledObjects,
    last_error: plan.lastError,
    created_at: plan.createdAt,
    updated_at: plan.updatedAt,
  };
}

const ENCRYPTION_KEY = "b".repeat(32);
const PACKED_VAULT_TOKEN = (() => {
  const encrypted = encryptToken("meta-test-access-token", ENCRYPTION_KEY);
  return `\\x${Buffer.from(JSON.stringify(encrypted), "utf8").toString("hex")}`;
})();

describe("activatePausedMetaPublish", () => {
  it("throws no_paused_plan when the ad was never published", async () => {
    const db = new FakeSupabase();
    await assert.rejects(
      activatePausedMetaPublish(db as never, {
        adId: "ad-001",
        workspaceId: "ws-001",
        providerWritesEnabled: true,
      }),
      (err: unknown) => err instanceof PublishError && err.code === "no_paused_plan",
    );
  });

  it("refuses a dry-run (draft) publish even when provider writes are enabled", async () => {
    const db = new FakeSupabase();
    const plan = pausedPlan();
    plan.status = "draft";
    db.tables.meta_publish_plans.push(planToRow(plan));

    await assert.rejects(
      activatePausedMetaPublish(db as never, {
        adId: "ad-001",
        workspaceId: "ws-001",
        providerWritesEnabled: true,
      }),
      (err: unknown) => err instanceof PublishError && err.code === "never_created_on_meta",
    );
  });

  it("returns a dry-run receipt when provider writes are disabled and writes nothing", async () => {
    const db = new FakeSupabase();
    db.tables.meta_publish_plans.push(planToRow(pausedPlan()));

    const outcome = await activatePausedMetaPublish(db as never, {
      adId: "ad-001",
      workspaceId: "ws-001",
      requestedBy: "user-1",
      providerWritesEnabled: false,
    });

    assert.equal(outcome.mode, "dry_run");
    if (outcome.mode === "dry_run") {
      assert.equal(outcome.status, "paused");
      assert.equal(outcome.targets.campaignId, "1001");
      assert.match(outcome.message, /NOT applied/i);
      assert.match(outcome.message, /stays PAUSED on Meta/i);
    }
    // Nothing was written — no mutation, no approval, no object status change.
    assert.equal(db.tables.meta_publish_plan_mutations.length, 0);
    assert.equal(db.tables.approval_requests.length, 0);
    const row = db.tables.meta_publish_plans[0]!;
    assert.equal((row.reconciled_objects_json as Row).objectStatuses, undefined);
  });

  it("activates the paused objects on Meta only on an explicit click", async () => {
    const db = new FakeSupabase();
    db.tables.meta_publish_plans.push(planToRow(pausedPlan()));
    db.rpcs["provider_token_vault_get"] = () => ({
      data: {
        encrypted_access_token: PACKED_VAULT_TOKEN,
        encrypted_refresh_token: null,
        token_nonce: "test-nonce",
      },
      error: null,
    });

    const activated = new Set<string>();
    const activeOrder: string[] = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const objectId = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
      if ((init?.method ?? "GET") === "GET") {
        const status = activated.has(objectId) ? "ACTIVE" : "PAUSED";
        return new Response(
          JSON.stringify({ configured_status: status, effective_status: status, status }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (body.status === "ACTIVE") {
        activated.add(objectId);
        activeOrder.push(objectId);
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const previousKey = process.env.TOKEN_ENCRYPTION_KEY;
    const previousWrites = process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES;
    process.env.TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
    process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES = "true";
    try {
      const outcome = await activatePausedMetaPublish(db as never, {
        adId: "ad-001",
        workspaceId: "ws-001",
        requestedBy: "user-1",
        providerWritesEnabled: true,
        fetchImpl,
      });

      assert.equal(outcome.mode, "activate");
      if (outcome.mode === "activate") {
        assert.equal(outcome.status, "activated");
        assert.equal(outcome.targets.campaignId, "1001");
        assert.match(outcome.message, /Activated on Meta/i);
      }

      // Safe activation order: children (ad set, ads) before the campaign.
      assert.deepEqual(activeOrder, ["1002", "1003", "1004", "1001"]);

      // The mutation row is the durable activation record: applied, activate action.
      const mutationRow = db.tables.meta_publish_plan_mutations[0]!;
      assert.equal(mutationRow.action, "activate");
      assert.equal(mutationRow.status, "applied");
      assert.equal((mutationRow.payload_json as Row).campaignId, "1001");
      assert.ok((mutationRow.response_log_json as unknown[]).length > 0);

      // The Activate click was the explicit approval.
      const approvalRow = db.tables.approval_requests[0]!;
      assert.equal(approvalRow.status, "approved");

      // The plan records ACTIVE object statuses, but its status stays paused_live.
      const planRow = db.tables.meta_publish_plans[0]!;
      const reconciled = planRow.reconciled_objects_json as Row;
      const objectStatuses = (reconciled.objectStatuses ?? {}) as {
        campaign?: { configuredStatus?: string };
      };
      assert.equal(objectStatuses.campaign?.configuredStatus, "ACTIVE");
      assert.equal(planRow.status, "paused_live");

      // Audit trail written by the canonical executor.
      assert.ok(db.tables.audit_logs.some(row => row.action === "meta.activate"));
    } finally {
      if (previousKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
      else process.env.TOKEN_ENCRYPTION_KEY = previousKey;
      if (previousWrites === undefined) delete process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES;
      else process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES = previousWrites;
    }
  });
});
