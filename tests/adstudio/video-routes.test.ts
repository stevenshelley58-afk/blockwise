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
  assert.match(get, /export async function PATCH/u);
  assert.match(get, /expectedVersion/u);
  assert.match(get, /renderJob/u);
  assert.match(get, /createSignedUrl/u);
  assert.match(script, /checkRateLimit/u);
  assert.match(script, /adstudio-video-script/u);
  assert.match(render, /queueVideoRender/u);
  assert.match(render, /validateVideoScriptPlan/u);
  assert.match(script, /status: "script_ready"/u);
  assert.match(render, /adstudio-video-render/u);
  assert.match(create, /requireReadiness: false/u);
  const media = route("[id]", "media");
  assert.match(media, /checkRateLimit/u);
  assert.match(media, /adstudio-video-upload/u);
  assert.match(media, /video_quota/u);
});

test("video routes return safe customer errors instead of provider details", () => {
  const script = route("[id]", "script");
  const render = route("[id]", "render");
  assert.match(script, /Script generation is temporarily unavailable/u);
  assert.match(render, /Video render could not be queued/u);
  assert.doesNotMatch(script, /OPENAI_API_KEY|ProviderRequestError|model profile/iu);
  assert.doesNotMatch(render, /OPENAI_API_KEY|ProviderRequestError|model profile/iu);
});

test("video integration seams keep media uploads and outputs workspace-fenced", () => {
  const meta = fs.readFileSync(path.join(root, "src", "lib", "providers", "meta-execution.ts"), "utf8");
  const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "20260831010000_adstudio_video_projects.sql"), "utf8");
  assert.match(meta, /new FormData\(\)/u);
  assert.match(meta, /postMetaVideoObject/u);
  assert.doesNotMatch(meta, /source: creative\.asset\.bytesBase64/u);
  assert.match(migration, /image\/jpeg.*image\/png.*text\/vtt/su);
  assert.match(migration, /foreign key \(workspace_id, output_mp4_asset_id\)/u);
  assert.match(migration, /foreign key \(workspace_id, output_poster_asset_id\)/u);
  assert.match(migration, /workspace_project_sha256_mime_key/u);
  assert.match(migration, /adstudio_check_video_workspace_quota/u);
});

test("video finalize is metadata-only and leaves byte attestation to the worker", () => {
  const storage = fs.readFileSync(path.join(root, "src", "lib", "adstudio", "video", "storage.ts"), "utf8");
  const finalize = storage.slice(storage.indexOf("export async function finalizeVideoUpload"));
  assert.doesNotMatch(finalize, /bucket\.download/u);
  assert.match(finalize, /bucket\.info/u);
  assert.match(finalize, /worker_sha256_magic_codec_duration_attestation_required/u);
});
