import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd());
const source = (...parts: string[]) =>
  fs.readFileSync(path.join(root, ...parts), "utf8");

test("Ad Studio uses one private workbench shell", () => {
  const shell = source("src", "components", "adstudio", "studio-shell.tsx");
  const navigation = source(
    "src",
    "components",
    "adstudio",
    "studio-navigation.tsx",
  );
  const selfServe = source("src", "components", "self-serve-shell.tsx");

  assert.match(shell, /bg-\(--ink\)/u);
  assert.match(shell, /Back to Blockwise/u);
  assert.match(shell, /<StudioNavigation/u);
  assert.match(shell, /min-h-dvh/u);
  assert.match(navigation, /Create/u);
  assert.match(navigation, /Ads/u);
  assert.match(navigation, /Assets/u);
  assert.match(navigation, /Brand Pack/u);
  assert.match(selfServe, /pathname\.startsWith\("\/ad-studio"\)/u);
});

test("Create home points to one dominant ad path and the short video flow", () => {
  const home = source("src", "app", "(customer)", "ad-studio", "page.tsx");
  assert.match(home, /Create an ad/u);
  assert.match(home, /Short video/u);
  assert.match(home, /\/ad-studio\/video\/new/u);
  assert.match(home, /id="templates"/u);
});

test("video flow keeps the guided contract, honest API states, and touch targets", () => {
  const flow = source(
    "src",
    "components",
    "adstudio",
    "video",
    "video-new-flow.tsx",
  );
  const player = source(
    "src",
    "components",
    "adstudio",
    "video",
    "video-preview-player.tsx",
  );
  const uploader = source(
    "src",
    "components",
    "adstudio",
    "video",
    "video-asset-upload.ts",
  );

  for (const endpoint of ["/api/adstudio/videos", "/script", "/render"])
    assert.match(flow, new RegExp(endpoint.replaceAll("/", "\\/"), "u"));
  for (const beat of ["Hook", "Proof", "Value", "CTA"]) {
    assert.match(player, new RegExp(beat, "u"));
  }
  assert.match(flow, /four fixed beats/u);
  assert.match(flow, /role="alert"/u);
  assert.match(flow, /role="status"/u);
  assert.match(flow, /Queueing/u);
  assert.match(flow, /Save draft/u);
  assert.match(flow, /min-h-11/u);
  assert.match(player, /min-w-11/u);
  assert.match(player, /captions and CTA end card included/u);
  assert.match(flow, /renderUrl/u);
  assert.match(flow, /pollProject/u);
  assert.match(uploader, /SHA-256/u);
  assert.match(uploader, /prepare/u);
  assert.match(uploader, /finalize/u);
  assert.match(uploader, /adstudio-videos/u);
  assert.doesNotMatch(flow, /<Timeline|<Keyframe|model picker/iu);
});
