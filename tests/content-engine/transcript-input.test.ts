import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createContentRunInputSchema,
  deriveTranscriptTopic,
} from "../../src/lib/content-engine/contracts.ts";

const baseInput = {
  target_audience: "Australian real estate agents",
  business_goal: "Teach a practical idea and create qualified interest",
  primary_cta: "Start a free Blockwise trial",
  content_angle: "Extract the strongest useful argument",
  offer: "A practical Blockwise field guide",
};

test("transcript-only content input derives a useful working topic", () => {
  const transcript = [
    "[00:00] HOST: Most agents start by asking homeowners for an appraisal too early.",
    "The better first offer is useful local evidence that meets the owner where they are.",
  ].join("\n");

  const parsed = createContentRunInputSchema.parse({
    ...baseInput,
    topic: "",
    source_transcript: transcript,
    source_url: "",
  });

  assert.equal(parsed.topic, "Most agents start by asking homeowners for an appraisal too early.");
  assert.equal(parsed.source_transcript, transcript);
  assert.equal(parsed.source_url, undefined);
});

test("content input still supports a topic-only run", () => {
  const parsed = createContentRunInputSchema.parse({
    ...baseInput,
    topic: "Why local evidence creates a better seller conversation",
  });

  assert.equal(parsed.topic, "Why local evidence creates a better seller conversation");
  assert.equal(parsed.source_transcript, undefined);
});

test("content input requires a transcript or working topic", () => {
  const parsed = createContentRunInputSchema.safeParse({
    ...baseInput,
    topic: "",
    source_transcript: "",
  });

  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.equal(parsed.error.issues[0]?.path.join("."), "source_transcript");
    assert.match(parsed.error.issues[0]?.message ?? "", /transcript or add a working topic/iu);
  }
});

test("derived topics stay within the content run storage limit", () => {
  const topic = deriveTranscriptTopic(`Speaker: ${"specific local evidence ".repeat(20)}`);

  assert.ok(topic.length <= 220);
  assert.match(topic, /\.\.\.$/u);
});

test("operator intake makes transcript the primary required field", () => {
  const component = readFileSync("src/components/operator/content-runs/content-run-console.tsx", "utf8");
  const page = readFileSync("src/app/(operator)/operator/content-runs/page.tsx", "utf8");
  const css = readFileSync("src/app/globals.css", "utf8");

  assert.match(component, /Create a guide from a transcript/u);
  assert.match(component, /name="source_transcript"|value=\{form\.source_transcript\}/u);
  assert.match(component, /minLength=\{80\}/u);
  assert.match(component, /<details className="content-run-advanced">/u);
  assert.match(component, /Create guide draft/u);
  assert.match(page, /title="Transcript to guide"/u);
  assert.doesNotMatch(component, /\bblog\b/iu);
  assert.doesNotMatch(page, /\bblog\b/iu);
  assert.match(css, /\.content-run-transcript-field/u);
  assert.match(css, /min-height: 44px/u);
});

test("prompt migration activates transcript-aware guide prompts", () => {
  const migration = readFileSync("supabase/migrations/202607220001_content_guide_prompt_v3.sql", "utf8");

  assert.match(migration, /source_transcript/iu);
  assert.match(migration, /sold-price-list seller-leads guide/iu);
  assert.match(migration, /Do not reproduce a distinctive run of more than eight words/iu);
  assert.match(migration, /'Guide writer'/u);
  assert.match(migration, /guide_title/u);
  assert.match(migration, /guide_outline/u);
  assert.match(migration, /Return strict JSON with guide, images/iu);
  assert.match(migration, /default-blockwise-authority-v1/iu);
});
