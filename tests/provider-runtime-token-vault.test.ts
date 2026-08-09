import assert from "node:assert/strict";
import test from "node:test";

import {
  loadRuntimeProviderToken,
  upsertRuntimeProviderToken,
} from "../src/lib/providers/provider-connections.ts";

const encryptionKey = "0123456789abcdef0123456789abcdef";

test("runtime provider credentials round-trip only through the service-role RPC", { concurrency: false }, async () => {
  const previousKey = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = encryptionKey;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let stored: Record<string, unknown> | undefined;
  const service = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "runtime_provider_token_vault_upsert") {
        stored = args;
        return { data: null, error: null };
      }
      if (name === "runtime_provider_token_vault_get") {
        return {
          data: stored
            ? [{
                encrypted_access_token: stored.p_encrypted_access_token,
                token_nonce: stored.p_token_nonce,
              }]
            : [],
          error: null,
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  } as unknown as Parameters<typeof loadRuntimeProviderToken>[0];

  try {
    await upsertRuntimeProviderToken({
      serviceSupabase: service,
      provider: "openai",
      accessToken: "sk-runtime-test-1234",
    });
    const token = await loadRuntimeProviderToken(service, "openai");

    assert.equal(token, "sk-runtime-test-1234");
    assert.deepEqual(calls.map((call) => call.name), [
      "runtime_provider_token_vault_upsert",
      "runtime_provider_token_vault_get",
    ]);
    assert.equal(stored?.p_runtime_provider, "openai");
    assert.equal(stored?.p_token_last_four, "1234");
    assert.notEqual(stored?.p_encrypted_access_token, "sk-runtime-test-1234");
  } finally {
    if (previousKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = previousKey;
  }
});

test("runtime provider credential lookup fails closed on vault errors", async () => {
  const service = {
    async rpc() {
      return { data: null, error: { message: "permission denied" } };
    },
  } as unknown as Parameters<typeof loadRuntimeProviderToken>[0];

  await assert.rejects(
    loadRuntimeProviderToken(service, "openai"),
    /runtime_provider_token_vault_get failed: permission denied/,
  );
});
