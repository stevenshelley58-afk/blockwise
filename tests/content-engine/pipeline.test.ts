import assert from "node:assert/strict";
import test from "node:test";

import { CONTENT_STEPS } from "../../src/lib/content-engine/contracts.ts";
import { deterministicContentSkillOutput } from "../../src/lib/content-engine/deterministic.ts";
import { modelProfileForContentPolicy } from "../../src/lib/content-engine/model-router.ts";
import { runContentRun } from "../../src/lib/content-engine/orchestrator.ts";
import { renderPrompt } from "../../src/lib/content-engine/prompts.ts";
import { createDeterministicContentProvider } from "../../src/lib/content-engine/provider.ts";

test("content model policies map to existing model profiles instead of hardcoded models", () => {
  assert.equal(modelProfileForContentPolicy("best_reasoning"), "high_quality_strategy");
  assert.equal(modelProfileForContentPolicy("best_copywriting"), "high_quality_strategy");
  assert.equal(modelProfileForContentPolicy("best_json"), "structured_json");
  assert.equal(modelProfileForContentPolicy("critic_review"), "compliance_review");
  assert.equal(modelProfileForContentPolicy("best_image_generation"), "image_final");
});

test("prompt rendering substitutes structured variables without mutating templates", () => {
  const template = "Topic {{topic}}\nOutline {{article_outline}}\nMissing {{missing}}";
  const rendered = renderPrompt(template, {
    topic: "Bad leads from Meta",
    article_outline: [{ heading: "Wrong signal" }],
  });

  assert.equal(template.includes("{{topic}}"), true);
  assert.match(rendered, /Topic Bad leads from Meta/);
  assert.match(rendered, /Wrong signal/);
  assert.match(rendered, /Missing\s*$/);
});

test("deterministic content outputs include required commercial funnel artifacts", () => {
  const run = sampleRunInput();
  const strategy = deterministicContentSkillOutput("blockwise-content-strategist", {
    run,
    artifacts: {},
  });

  assert.equal(strategy.cta, "Book a Blockwise demo");
  assert.equal(strategy.lead_magnet, "Free Blockwise Seller Lead Audit");
  assert.deepEqual(Object.keys(strategy.funnel_mapping as Record<string, unknown>), [
    "blog",
    "lead_magnet",
    "instant_form",
    "ad",
    "follow_up",
  ]);
});

test("runContentRun creates a complete draft package and review trace with deterministic provider", async () => {
  const supabase = createFakeSupabase();
  const result = await runContentRun({
    supabase: supabase as never,
    runId: "run-1",
    provider: createDeterministicContentProvider(),
  });

  assert.deepEqual(result, { runId: "run-1", status: "waiting_operator_approval" });
  assert.equal(supabase.table("content_runs")[0].status, "waiting_operator_approval");
  assert.equal(supabase.table("prompt_runs").length, CONTENT_STEPS.length);
  assert.equal(supabase.table("content_artifacts").some((row) => row.artifact_type === "artifact_package"), true);
  assert.equal(supabase.table("content_artifacts").some((row) => row.artifact_type === "lead_ad"), true);
  assert.equal(supabase.table("content_reviews").some((row) => row.review_type === "compliance"), true);
  assert.equal(supabase.table("content_reviews").some((row) => row.review_type === "final_agent"), true);
});

function sampleRunInput() {
  return {
    topic: "Why most real estate agents get bad leads from Meta",
    target_audience: "Australian real estate agents",
    business_goal: "Generate Blockwise demo leads",
    primary_cta: "Book a Blockwise demo",
    content_angle: "Meta is optimising toward the wrong signal",
    offer: "Free Blockwise Seller Lead Audit",
    status: "draft_only" as const,
  };
}

function createFakeSupabase() {
  const tables: Record<string, Array<Record<string, any>>> = {
    prompt_sets: [{ id: "prompt-set-1", name: "default-blockwise-authority-v1", description: "", status: "active" }],
    prompt_templates: CONTENT_STEPS.map((step, index) => ({
      id: `prompt-${index}`,
      key: `content.${index}`,
      name: step.skillName,
      skill_name: step.skillName,
      description: "",
      template_body: "Return JSON for {{topic}} with {{artifact_package}}",
      status: "active",
      version: 1,
      created_at: "2026-06-04T00:00:00.000Z",
      updated_at: "2026-06-04T00:00:00.000Z",
    })),
    prompt_set_items: CONTENT_STEPS.map((step, index) => ({
      id: `item-${index}`,
      prompt_set_id: "prompt-set-1",
      skill_name: step.skillName,
      prompt_template_id: `prompt-${index}`,
      prompt_version: 1,
      model_policy_id: step.defaultModelPolicy,
    })),
    model_profile_versions: [],
    content_runs: [{
      id: "run-1",
      workspace_id: "workspace-1",
      operator_user_id: "user-1",
      ...sampleRunInput(),
      prompt_set_id: "prompt-set-1",
      model_policy_id: "best-available-balanced",
      publish_mode: "draft_only",
      status: "queued",
      current_step: null,
      input_json: sampleRunInput(),
      error_message: null,
      created_at: "2026-06-04T00:00:00.000Z",
      updated_at: "2026-06-04T00:00:00.000Z",
      completed_at: null,
    }],
    content_artifacts: [],
    prompt_runs: [],
    content_reviews: [],
    operator_approvals: [],
  };

  return {
    table(name: string) {
      return tables[name];
    },
    from(name: string) {
      return new FakeQuery(tables, name);
    },
  };
}

class FakeQuery implements PromiseLike<{ data: any; error: null }> {
  private readonly tables: Record<string, Array<Record<string, any>>>;
  private readonly tableName: string;
  private filters: Array<{ column: string; value: any; op: "eq" | "is" }> = [];
  private operation: "select" | "insert" | "update" | "upsert" = "select";
  private payload: any;
  private limitValue: number | null = null;
  private singleMode: "single" | "maybeSingle" | null = null;
  private conflictKey = "id";

  constructor(tables: Record<string, Array<Record<string, any>>>, tableName: string) {
    this.tables = tables;
    this.tableName = tableName;
  }

  select() {
    this.operation = this.operation === "select" ? "select" : this.operation;
    return this;
  }

  insert(value: any) {
    this.operation = "insert";
    this.payload = value;
    return this;
  }

  update(value: any) {
    this.operation = "update";
    this.payload = value;
    return this;
  }

  upsert(value: any, options?: { onConflict?: string }) {
    this.operation = "upsert";
    this.payload = value;
    this.conflictKey = options?.onConflict ?? "id";
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push({ column, value, op: "eq" });
    return this;
  }

  is(column: string, value: any) {
    this.filters.push({ column, value, op: "is" });
    return this;
  }

  order() {
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  single() {
    this.singleMode = "single";
    return this.execute();
  }

  maybeSingle() {
    this.singleMode = "maybeSingle";
    return this.execute();
  }

  then<TResult1 = { data: any; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute() {
    const table = this.tables[this.tableName] ?? (this.tables[this.tableName] = []);

    if (this.operation === "insert") {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = rows.map((row) => ({ id: row.id ?? `${this.tableName}-${table.length + 1}`, ...row }));
      table.push(...inserted);
      return this.finish(inserted);
    }

    if (this.operation === "update") {
      const rows = this.filtered(table);
      for (const row of rows) Object.assign(row, this.payload);
      return this.finish(rows);
    }

    if (this.operation === "upsert") {
      const keys = this.conflictKey.split(",");
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const saved = rows.map((row) => {
        const existing = table.find((candidate) => keys.every((key) => candidate[key] === row[key]));
        if (existing) {
          Object.assign(existing, row);
          return existing;
        }
        const inserted = { id: row.id ?? `${this.tableName}-${table.length + 1}`, ...row };
        table.push(inserted);
        return inserted;
      });
      return this.finish(saved);
    }

    return this.finish(this.filtered(table));
  }

  private filtered(rows: Array<Record<string, any>>) {
    const filtered = rows.filter((row) =>
      this.filters.every((filter) => filter.op === "is" ? row[filter.column] === filter.value : row[filter.column] === filter.value),
    );
    return this.limitValue === null ? filtered : filtered.slice(0, this.limitValue);
  }

  private finish(rows: Array<Record<string, any>>) {
    if (this.singleMode || rows.length === 1) {
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }
}
