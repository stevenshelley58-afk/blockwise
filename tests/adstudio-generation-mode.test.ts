import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  adStudioGenerationFailureMessage,
  resolveAdStudioGenerationMode,
} from "../src/lib/adstudio/generation-mode.ts";

test("AdStudio Fast and High Quality map to exact pinned direct candidates", () => {
  const fast = resolveAdStudioGenerationMode("fast");
  const high = resolveAdStudioGenerationMode("high");
  assert.deepEqual([fast.copy.provider, fast.copy.model, fast.image.provider, fast.image.model, fast.qa.provider, fast.qa.model], [
    "google", "gemini-2.5-flash-lite", "google", "gemini-3.1-flash-image", "google", "gemini-2.5-flash-lite",
  ]);
  assert.deepEqual([high.copy.provider, high.copy.model, high.image.provider, high.image.model, high.qa.provider, high.qa.model], [
    "openai", "gpt-5.5", "openai", "gpt-image-2", "openai", "gpt-5.5",
  ]);
});

test("customer failure messages name the mode and never expose provider details", () => {
  assert.equal(adStudioGenerationFailureMessage("fast"), "Fast generation is unavailable right now. Nothing was saved. Try again, or choose High quality.");
  assert.equal(adStudioGenerationFailureMessage("high"), "High quality generation is unavailable right now. Nothing was saved. Try again, or choose Fast.");
  assert.doesNotMatch(adStudioGenerationFailureMessage("fast"), /openai|gemini|key|credit/iu);
});

test("cutover migration persists mode, canonicalizes profiles, and asserts direct-only state", () => {
  const sql = readFileSync("supabase/migrations/202607190002_direct_openai_gemini_cutover.sql", "utf8");
  assert.match(sql, /generation_quality text/);
  assert.match(sql, /set generation_quality = 'high'/);
  assert.match(sql, /alter column generation_quality set default 'fast'/);
  assert.match(sql, /adstudio_persist_campaign_pack_v2/);
  assert.match(sql, /provider not in \('openai', 'google'\)/);
  assert.match(sql, /array_remove\(allowed_outbound_domains/);
  assert.match(sql, /raise exception 'Direct-provider cutover left an unsupported active model profile version'/);
});

test("campaign persistence and edit routing retain the original mode", () => {
  const persistence = readFileSync("src/lib/adstudio/persistence.ts", "utf8");
  const edit = readFileSync("src/app/api/adstudio/creatives/[id]/edit/route.ts", "utf8");
  assert.match(persistence, /generation_quality: pack\.campaign\.generationQuality/);
  assert.match(edit, /select\("generation_quality"\)/);
  assert.match(edit, /resolveCloneProvider\(generationQuality\)/);
});
