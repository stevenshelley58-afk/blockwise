import assert from "node:assert/strict";
import test from "node:test";

import { metaPublishProviderWritesEnabled } from "../../src/lib/providers/meta-provider-write-gate.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";

test("Meta publish writes fail closed unless both gates allow the exact workspace", () => {
  assert.equal(metaPublishProviderWritesEnabled(workspaceId, {}), false);
  assert.equal(metaPublishProviderWritesEnabled(workspaceId, {
    BLOCKWISE_ENABLE_PROVIDER_WRITES: "true",
  }), false);
  assert.equal(metaPublishProviderWritesEnabled(workspaceId, {
    BLOCKWISE_ENABLE_PROVIDER_WRITES: "false",
    BLOCKWISE_META_PUBLISH_WORKSPACE_ALLOWLIST: workspaceId,
  }), false);
  assert.equal(metaPublishProviderWritesEnabled(workspaceId, {
    BLOCKWISE_ENABLE_PROVIDER_WRITES: "true",
    BLOCKWISE_META_PUBLISH_WORKSPACE_ALLOWLIST: "not-a-uuid,22222222-2222-4222-8222-222222222222",
  }), false);
});

test("Meta publish writes allow only a normalized exact workspace match", () => {
  assert.equal(metaPublishProviderWritesEnabled(workspaceId.toUpperCase(), {
    BLOCKWISE_ENABLE_PROVIDER_WRITES: "true",
    BLOCKWISE_META_PUBLISH_WORKSPACE_ALLOWLIST: ` 22222222-2222-4222-8222-222222222222, ${workspaceId.toUpperCase()} `,
  }), true);
});
