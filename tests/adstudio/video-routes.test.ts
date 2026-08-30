import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd());
const route = (...parts: string[]) => fs.readFileSync(path.join(root, "src", "app", "api", "adstudio", "videos", ...parts, "route.ts"), "utf8");

test("video routes authenticate and use workspace-scoped repository context", () => {
  const create = route();
  const get = route("[id]");
  const script = route("[id]", "script");
  const render = route("[id]", "render");
  for (const source of [create, get, script, render]) {
    assert.match(source, /requireAdStudioRequest/u);
    assert.match(source, /workspaceId: access\.access\.workspaceId/u);
    assert.match(source, /userId: access\.access\.userId/u);
  }
  assert.match(script, /checkRateLimit/u);
  assert.match(script, /adstudio-video-script/u);
  assert.match(render, /queueVideoRender/u);
});

test("video routes return safe customer errors instead of provider details", () => {
  const script = route("[id]", "script");
  const render = route("[id]", "render");
  assert.match(script, /Script generation is temporarily unavailable/u);
  assert.match(render, /Video render could not be queued/u);
  assert.doesNotMatch(script, /OPENAI_API_KEY|ProviderRequestError|model profile/iu);
  assert.doesNotMatch(render, /OPENAI_API_KEY|ProviderRequestError|model profile/iu);
});
