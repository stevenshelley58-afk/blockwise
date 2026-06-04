import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = "supabase/migrations/202606040003_content_to_lead_engine.sql";

const tables = [
  "prompt_sets",
  "prompt_templates",
  "prompt_set_items",
  "content_runs",
  "content_artifacts",
  "prompt_runs",
  "content_reviews",
  "operator_approvals",
];

test("content engine migration creates all content and prompt tables", () => {
  const sql = readFileSync(migration, "utf8");

  for (const table of tables) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\b`, "i"));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
});

test("content engine migration keeps generated traces server-owned", () => {
  const sql = readFileSync(migration, "utf8");

  for (const table of ["content_artifacts", "prompt_runs", "content_reviews"]) {
    assert.match(sql, new RegExp(`${table}_server_owned_no_client_insert`, "i"));
    assert.match(sql, new RegExp(`${table}_server_owned_no_client_update`, "i"));
    assert.match(sql, new RegExp(`${table}_server_owned_no_client_delete`, "i"));
  }
});

test("content engine migration seeds default prompt set and separate skill templates", () => {
  const sql = readFileSync(migration, "utf8");

  assert.match(sql, /default-blockwise-authority-v1/i);
  for (const skill of [
    "blockwise-topic-researcher",
    "blockwise-content-strategist",
    "blockwise-blog-writer",
    "blockwise-blog-editor",
    "blockwise-blog-formatter",
    "blockwise-image-brief-writer",
    "blockwise-social-post-generator",
    "blockwise-lead-ad-generator",
    "blockwise-instant-form-generator",
    "blockwise-compliance-reviewer",
    "blockwise-agent-reviewer",
    "blockwise-artifact-packager",
  ]) {
    assert.match(sql, new RegExp(skill, "i"));
  }
});

