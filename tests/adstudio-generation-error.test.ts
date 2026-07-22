import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { publicAdStudioGenerationError } from "../src/lib/adstudio/generation-error.ts";

test("provider failures are replaced with customer-safe recovery copy", () => {
  const message = publicAdStudioGenerationError(
    "openrouter (openai/gpt-4.1-mini): Insufficient credits. Add more using https://openrouter.ai/settings/credits",
  );

  assert.equal(
    message,
    "Blockwise couldn't reach the ad generation service. Your details are still here. Try again in a moment.",
  );
  assert.doesNotMatch(message, /openrouter|openai|credits|https?:/i);
});

test("useful non-provider generation failures remain actionable", () => {
  assert.equal(
    publicAdStudioGenerationError('Image for "Property image" could not be read.'),
    'Image for "Property image" could not be read.',
  );
});

test("job polling and synchronous generation both sanitize provider errors", () => {
  const jobRoute = readFileSync("src/app/api/adstudio/jobs/[id]/route.ts", "utf8");
  const campaignRoute = readFileSync("src/app/api/adstudio/campaigns/route.ts", "utf8");

  assert.match(jobRoute, /publicAdStudioGenerationError\(data\.error\)/);
  assert.match(campaignRoute, /publicAdStudioGenerationError\(error\)/);
});

test("production migration restores only the exact stale structured-copy override", () => {
  const migration = readFileSync(
    "supabase/migrations/202607220002_restore_structured_copy_direct_provider.sql",
    "utf8",
  );

  assert.match(migration, /mp\.key = 'structured_json'/);
  assert.match(migration, /v\.provider = 'openrouter'/);
  assert.match(migration, /v\.model = 'openai\/gpt-4\.1-mini'/);
  assert.match(migration, /provider = 'openai'/);
  assert.match(migration, /model = 'gpt-5\.5'/);
});
