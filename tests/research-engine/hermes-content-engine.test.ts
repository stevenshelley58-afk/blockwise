import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTENT_RUN_JOB_TYPE,
  CONTENT_STEPS,
  artifactsForContentSkill,
  deterministicContentSkillOutput,
  handleHermesContentRun,
  modelForContentSkill,
} from "../../hermes/tools/research-runtime/bin/content-engine.mjs";

test("Hermes content model routing uses content policy overrides before defaults", () => {
  assert.equal(
    modelForContentSkill(
      {
        HERMES_CONTENT_MODELS_JSON: JSON.stringify({
          best_copywriting: "copy-model",
          "blockwise-blog-writer": "writer-model",
        }),
        HERMES_CONTENT_DEFAULT_MODEL: "default-model",
      },
      "best_copywriting",
      "blockwise-blog-writer",
    ),
    "writer-model",
  );
  assert.equal(
    modelForContentSkill(
      {
        HERMES_CONTENT_MODELS_JSON: JSON.stringify({ best_copywriting: "copy-model" }),
        HERMES_CONTENT_DEFAULT_MODEL: "default-model",
      },
      "best_copywriting",
      "blockwise-social-post-generator",
    ),
    "copy-model",
  );
});

test("Hermes content handler turns a work_queue job into draft artifacts and review state", async () => {
  const db = createFakeRestDb();
  const result = await handleHermesContentRun(
    {
      id: "job-1",
      job_type: CONTENT_RUN_JOB_TYPE,
      payload: { contentRunId: "run-1", workspaceId: "workspace-1" },
    },
    {
      rest: db.rest,
      now: () => "2026-06-04T00:00:00.000Z",
      env: { HERMES_CONTENT_DRY_RUN: "true" },
    },
  );

  assert.equal(result.status, "complete");
  assert.equal(db.tables.content_runs[0].status, "waiting_operator_approval");
  assert.equal(db.tables.prompt_runs.length, CONTENT_STEPS.length);
  assert.equal(db.tables.content_artifacts.some((row: Record<string, unknown>) => row.artifact_type === "artifact_package"), true);
  assert.equal(db.tables.content_artifacts.some((row: Record<string, unknown>) => row.artifact_type === "lead_ad"), true);
  assert.equal(db.tables.content_reviews.length, CONTENT_STEPS.length);
  assert.equal(
    db.tables.prompt_runs.every((row: Record<string, unknown>) => (
      row.input_json as Record<string, unknown>
    ).source_transcript === "A source transcript with enough detail to drive a useful guide draft."),
    true,
  );

  const artifactPackage = db.tables.content_artifacts.find((row: Record<string, unknown>) => row.artifact_type === "artifact_package");
  assert.deepEqual(artifactPackage?.data_json.approval_actions, ["approve_guide", "approve_images", "approve_social", "approve_ad", "request_changes"]);
  assert.equal(typeof artifactPackage?.data_json.guide, "object");
  assert.equal(artifactPackage?.data_json.blog, undefined);
  assert.equal(artifactPackage?.data_json.prompt_versions_used.length, CONTENT_STEPS.length);
  assert.equal(artifactPackage?.data_json.models_used.length, CONTENT_STEPS.length);
  assert.equal(artifactPackage?.data_json.models_used.every((row: Record<string, unknown>) => row.model_used === "hermes-deterministic-content"), true);
});

test("Hermes guide fallbacks use guide routes and titles while retaining legacy artifact types", () => {
  const run = {
    id: "run-1",
    topic: "A practical seller lead guide",
    target_audience: "Australian real estate agents",
    offer: "A practical Blockwise field guide",
    primary_cta: "Start a free Blockwise trial",
  };
  const input = { run, artifacts: {}, env: {} };
  const strategy = deterministicContentSkillOutput("blockwise-content-strategist", input);
  const seo = deterministicContentSkillOutput("blockwise-seo-schema-builder", input);
  const page = deterministicContentSkillOutput("blockwise-page-builder", input);
  const writerArtifact = artifactsForContentSkill("blockwise-blog-writer", {});
  const editorArtifact = artifactsForContentSkill("blockwise-blog-editor", {});

  assert.equal(strategy.guide_title, run.topic);
  assert.equal(strategy.blog_title, undefined);
  assert.match(String(seo.canonical), /^https:\/\/blockwise\.sale\/guides\//u);
  assert.match(String(page.page_path), /^\/guides\//u);
  assert.match(String(page.preview_url), /#guide-preview$/u);
  assert.equal(writerArtifact[0]?.artifactType, "blog_draft");
  assert.equal(writerArtifact[0]?.title, "Guide draft");
  assert.equal(editorArtifact[0]?.artifactType, "blog_final");
  assert.equal(editorArtifact[0]?.title, "Edited guide");
});

test("Hermes content handler times out stalled provider calls", async () => {
  const db = createFakeRestDb();

  await assert.rejects(
    handleHermesContentRun(
      {
        id: "job-1",
        job_type: CONTENT_RUN_JOB_TYPE,
        payload: { contentRunId: "run-1", workspaceId: "workspace-1" },
      },
      {
        rest: db.rest,
        now: () => "2026-06-04T00:00:00.000Z",
        env: {
          HERMES_CONTENT_MODEL_TIMEOUT_MS: "1000",
          HERMES_CONTENT_DEFAULT_MODEL: "test-model",
          OPENAI_API_KEY: "test-key",
        },
        fetchImpl: (url: RequestInfo | URL, init: RequestInit = {}) => new Promise((_resolve, reject) => {
          assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
          init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
        }),
      },
    ),
    /OpenAI content request timed out after 1000ms for blockwise-topic-researcher/u,
  );

  assert.equal(db.tables.content_runs[0].status, "failed");
  assert.match(db.tables.content_runs[0].error_message, /timed out/u);
});

function createFakeRestDb() {
  const tables: Record<string, Array<Record<string, any>>> = {
    content_runs: [{
      id: "run-1",
      workspace_id: "workspace-1",
      operator_user_id: "operator-1",
      topic: "Why most real estate agents get bad leads from Meta",
      target_audience: "Australian real estate agents",
      business_goal: "Generate Blockwise demo leads",
      content_angle: "Meta is optimising toward the wrong signal",
      offer: "Free Blockwise Seller Lead Audit",
      primary_cta: "Book a Blockwise demo",
      prompt_set_id: "prompt-set-1",
      model_policy_id: "best-available-balanced",
      input_json: {
        tone_profile: "direct, expert, no hype",
        source_transcript: "A source transcript with enough detail to drive a useful guide draft.",
        source_url: "https://example.com/source",
      },
      status: "queued",
    }],
    content_artifacts: [],
    prompt_runs: [],
    content_reviews: [],
    prompt_sets: [{ id: "prompt-set-1", name: "default-blockwise-authority-v1", status: "active" }],
    prompt_set_items: CONTENT_STEPS.map((step, index) => ({
      id: `item-${index}`,
      prompt_set_id: "prompt-set-1",
      skill_name: step.skillName,
      prompt_template_id: `prompt-${index}`,
      prompt_version: 1,
      model_policy_id: step.defaultModelPolicy,
    })),
    prompt_templates: CONTENT_STEPS.map((step, index) => ({
      id: `prompt-${index}`,
      key: `content.${index}`,
      name: step.skillName,
      skill_name: step.skillName,
      template_body: "Return JSON for {{topic}} using {{artifact_package}}",
      status: "active",
      version: 1,
    })),
  };

  return {
    tables,
    rest: async (_schema: string, path: string, init: { method?: string; body?: BodyInit | null } = {}) => {
      const [tableAndQuery, query = ""] = path.split("?");
      const table = tableAndQuery;
      const rows = tables[table] ?? (tables[table] = []);

      if (init.method === "PATCH") {
        const patch = JSON.parse(String(init.body || "{}"));
        const filtered = filterRows(rows, query);
        for (const row of filtered) Object.assign(row, patch);
        return filtered;
      }

      if (init.method === "POST") {
        const payload = JSON.parse(String(init.body || "{}"));
        const inserted = Array.isArray(payload) ? payload : [{ id: payload.id || `${table}-${rows.length + 1}`, ...payload }];
        rows.push(...inserted);
        return inserted;
      }

      return filterRows(rows, query);
    },
  };
}

function filterRows(rows: Array<Record<string, any>>, query: string) {
  const params = new URLSearchParams(query);
  let out = [...rows];
  for (const [key, value] of params.entries()) {
    if (key === "select" || key === "order") continue;
    if (key === "limit") {
      out = out.slice(0, Number(value));
      continue;
    }
    if (value.startsWith("eq.")) {
      out = out.filter((row) => String(row[key]) === decodeURIComponent(value.slice(3)));
    }
  }
  return out;
}
