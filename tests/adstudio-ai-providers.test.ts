import assert from "node:assert/strict";
import test from "node:test";

import { createOpenRouterTextProvider } from "../src/lib/adstudio/ai-providers.ts";

test("createOpenRouterTextProvider posts structured prompts and parses JSON responses", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createOpenRouterTextProvider({
    env: {
      OPENROUTER_API_KEY: "or_test",
      NEXT_PUBLIC_APP_URL: "https://app.blockwise.test",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ platform: "meta", primaryText: ["ok"] }) } }],
          usage: { prompt_tokens: 12, completion_tokens: 4 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
    model: "openai/gpt-4.1-mini",
  });

  const output = await provider.generate({
    system: "Return JSON",
    messages: [{ role: "user", content: "Build copy" }],
    schemaName: "metaLeadAdPack",
  });

  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer or_test");
  assert.deepEqual(output.json, { platform: "meta", primaryText: ["ok"] });
  assert.equal(output.usage.inputTokens, 12);
  assert.equal(output.providerMetadata.model, "openai/gpt-4.1-mini");
});
