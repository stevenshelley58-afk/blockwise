import assert from "node:assert/strict";
import test from "node:test";

import { createResearchServiceClient, tryCreateResearchServiceClient } from "../../src/lib/research/service.ts";

test("private research client rejects customer Supabase and opaque credentials", () => {
  assert.throws(
    () => createResearchServiceClient({
      env: {
        RESEARCH_API_URL: "https://blockwise.supabase.co",
        RESEARCH_API_SERVICE_KEY: "header.payload.signature",
      },
    }),
    /cannot point at customer Supabase/,
  );
  assert.throws(
    () => createResearchServiceClient({
      env: {
        RESEARCH_API_URL: "https://hermes.blockwise.sale/research",
        RESEARCH_API_SERVICE_KEY: "sb_secret_not_a_jwt",
      },
    }),
    /must be a signed JWT/,
  );
});

test("private research client fails closed when VPS configuration is absent", () => {
  assert.equal(tryCreateResearchServiceClient({ env: {} }), null);
});
