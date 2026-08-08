import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { workspaceMediaSrc } from "../../src/lib/adstudio/image-src.ts";
import { AdDocSlotMediaError, resolveAdDocSlotBytes } from "../../src/lib/adstudio/v2/media.ts";
import { renderAdDocToPng } from "../../src/lib/adstudio/v2/render/server.ts";
import { hashTemplateDoc } from "../../src/lib/adstudio/v2/template-hash.ts";
import { loadTemplateV2ByHash, matchesAdDocTemplatePin } from "../../src/lib/adstudio/v2/template-resolver.ts";
import { clampEditorNormBox, layoutPixelsToNormBox } from "../../src/components/adstudio/editor/geometry.ts";

const workspaceId = "workspace-editor";
const fixtureRoot = join(resolve(process.cwd()), "tests", "fixtures", "adstudio-v2");
const fontsDir = join(resolve(process.cwd()), "public", "fonts", "adstudio");

function pngDimensions(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

test("hash-pinned template resolver uses a matching history snapshot, never a mutated current doc", () => {
  const temp = mkdtempSync(join(tmpdir(), "adstudio-template-history-"));
  try {
    const templateId = "meta-fixture-story";
    const historical = JSON.parse(readFileSync(join(fixtureRoot, templateId, "template.json"), "utf8"));
    const current = structuredClone(historical);
    current.name = "Changed after this creative was made";
    const historicalHash = hashTemplateDoc(historical);
    const currentHash = hashTemplateDoc(current);
    const templateDir = join(temp, templateId);
    mkdirSync(join(templateDir, "history"), { recursive: true });
    writeFileSync(join(templateDir, "template.json"), JSON.stringify(current));
    writeFileSync(join(templateDir, "history", "before-qa.json"), JSON.stringify(historical));

    const env = { ADSTUDIO_GALLERY_V2_DIR: temp } as unknown as NodeJS.ProcessEnv;
    assert.equal(loadTemplateV2ByHash(templateId, currentHash, env)?.name, current.name);
    assert.equal(loadTemplateV2ByHash(templateId, historicalHash, env)?.name, historical.name);
    assert.equal(loadTemplateV2ByHash(templateId, "f".repeat(64), env), null);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("a v2 creative can only save against its own immutable template pin", () => {
  const instance = JSON.parse(readFileSync(join(fixtureRoot, "meta-fixture-story", "instance-feed.json"), "utf8"));
  assert.equal(matchesAdDocTemplatePin(instance, instance), true);
  assert.equal(matchesAdDocTemplatePin(instance, { ...instance, templateId: "another-template" }), false);
  assert.equal(matchesAdDocTemplatePin(instance, { ...instance, templateHash: "f".repeat(64) }), false);
  assert.equal(matchesAdDocTemplatePin({ objects: [] }, instance), false);
});

test("document re-render resolves declared workspace slot media and preserves it in feed and story edits", async () => {
  const template = JSON.parse(readFileSync(join(fixtureRoot, "meta-fixture-story", "template.json"), "utf8"));
  const photo = readFileSync(join(fixtureRoot, "public", "slots", "photo-landscape.png"));
  const downloaded: string[] = [];
  const storagePath = `${workspaceId}/adstudio/uploads/photo.png`;
  const supabase = {
    storage: {
      from: () => ({
        download: async (path: string) => {
          downloaded.push(path);
          return { data: new Blob([photo], { type: "image/png" }), error: null };
        },
      }),
    },
  };
  const base = JSON.parse(readFileSync(join(fixtureRoot, "meta-fixture-story", "instance-feed.json"), "utf8"));
  base.values.images = {
    photo: { src: workspaceMediaSrc(workspaceId, storagePath), focal: { x: 0.5, y: 0.5 }, zoom: 1 },
    ignored: { src: `${workspaceId}/not-a-declared-slot.png` },
  };
  base.values.text.headline = "A saved text edit";
  base.overrides = [{
    layerId: "feed-text-headline", op: "move", box: { x: 0.1, y: 0.64, width: 0.8, height: 0.12 },
  }];

  const slotBytes = await resolveAdDocSlotBytes({ supabase, workspaceId, template, instance: base });
  assert.deepEqual(downloaded, [storagePath], "only the template's declared slot is read");
  assert.deepEqual(slotBytes.get("photo"), photo);

  const feed = await renderAdDocToPng(template, base, "4:5", { repoRoot: fixtureRoot, fontsDir, slotBytes });
  const feedWithoutCustomerPhoto = await renderAdDocToPng(template, base, "4:5", { repoRoot: fixtureRoot, fontsDir });
  const story = await renderAdDocToPng(template, { ...base, format: "9:16", overrides: [{
    layerId: "story-text-headline", op: "move", box: { x: 0.1, y: 0.62, width: 0.8, height: 0.1 },
  }] }, "9:16", { repoRoot: fixtureRoot, fontsDir, slotBytes });

  assert.deepEqual(pngDimensions(feed), { width: 1080, height: 1350 });
  assert.deepEqual(pngDimensions(story), { width: 1080, height: 1920 });
  assert.equal(feed.equals(feedWithoutCustomerPhoto), false, "save render retains the customer photo");
});

test("required media fails closed when missing, cross-workspace, oversized, or invalid", async () => {
  const template = JSON.parse(readFileSync(join(fixtureRoot, "meta-fixture-story", "template.json"), "utf8"));
  const instance = JSON.parse(readFileSync(join(fixtureRoot, "meta-fixture-story", "instance-feed.json"), "utf8"));
  const unavailableStorage = {
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: "missing" } }) }) },
  };

  instance.values.images = {};
  await assert.rejects(
    resolveAdDocSlotBytes({ supabase: unavailableStorage, workspaceId, template, instance }),
    (error: unknown) => error instanceof AdDocSlotMediaError && /required photo/.test(error.message),
  );

  instance.values.images.photo = { src: workspaceMediaSrc("other-workspace", "other-workspace/photo.png") };
  await assert.rejects(
    resolveAdDocSlotBytes({ supabase: unavailableStorage, workspaceId, template, instance }),
    (error: unknown) => error instanceof AdDocSlotMediaError && /unavailable/.test(error.message),
  );

  instance.values.images.photo = { src: `${workspaceId}/adstudio/uploads/large.png` };
  const oversizedStorage = {
    storage: {
      from: () => ({
        download: async () => ({
          data: { size: 8 * 1024 * 1024 + 1, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Blob,
          error: null,
        }),
      }),
    },
  };
  await assert.rejects(
    resolveAdDocSlotBytes({ supabase: oversizedStorage, workspaceId, template, instance }),
    (error: unknown) => error instanceof AdDocSlotMediaError && /under 8 MB/.test(error.message),
  );

  instance.values.images.photo = { src: "data:image/png;base64,bm90LWFuLWltYWdl" };
  await assert.rejects(
    resolveAdDocSlotBytes({ supabase: unavailableStorage, workspaceId, template, instance }),
    (error: unknown) => error instanceof AdDocSlotMediaError && /JPG, PNG, or WebP/.test(error.message),
  );
});

test("drag geometry remains normalized for both feed and story and is clamped once", () => {
  const feed = layoutPixelsToNormBox({ width: 1080, height: 1350 }, { x: 216, y: 405, width: 540, height: 270 });
  const story = layoutPixelsToNormBox({ width: 1080, height: 1920 }, { x: 216, y: 576, width: 540, height: 384 });
  assert.deepEqual(feed, { x: 0.2, y: 0.3, width: 0.5, height: 0.2 });
  assert.deepEqual(story, { x: 0.2, y: 0.3, width: 0.5, height: 0.2 });
  assert.deepEqual(clampEditorNormBox({ x: 0.8, y: -0.1, width: 0.4, height: 0.2 }), {
    x: 0.6, y: 0, width: 0.4, height: 0.2,
  });
});
