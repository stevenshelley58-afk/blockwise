import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("video renderer production service is canonical and hardened", async () => {
  const compose = await readFile("infra/coolify/docker-compose.product.yml", "utf8");
  const block = compose.slice(compose.indexOf("  adstudio-video-renderer:"), compose.indexOf("\n  product-caddy:", compose.indexOf("  adstudio-video-renderer:")));
  assert.match(block, /profiles: \[worker\]/u);
  assert.match(block, /BLOCKWISE_VIDEO_WORKER_IMAGE:\?BLOCKWISE_VIDEO_WORKER_IMAGE is required/u);
  assert.match(block, /read_only: true/u); assert.match(block, /cap_drop: \[ALL\]/u); assert.match(block, /no-new-privileges:true/u);
  assert.doesNotMatch(block, /ports:/u); assert.match(block, /stevenshelley58-afk\/blockwise/u);
});

test("renderer image requires an exact lowercase merged SHA at build time", async () => {
  const dockerfile = await readFile("video-worker/Dockerfile", "utf8");
  assert.match(dockerfile, /org\.opencontainers\.image\.revision/u);
  assert.match(dockerfile, /GIT_SHA must be a full lowercase Git SHA/u);
  assert.match(dockerfile, /org\.opencontainers\.image\.source=.*stevenshelley58-afk\/blockwise/u);
});
