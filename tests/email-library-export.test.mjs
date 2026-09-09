import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
test("email archive includes verified raster assets and runs without installed dependencies", async () => {
  const scratch = await mkdtemp(resolve(tmpdir(), "blockwise-email-export-"));
  try {
    const output = resolve(scratch, "library");
    execFileSync(process.execPath, [resolve(root, "scripts/email/export-library.mjs"), output], { cwd: root, stdio: "pipe" });
    const manifest = JSON.parse(await readFile(resolve(output, "manifest.json"), "utf8"));
    assert.equal(manifest.sendingEnabled, false);
    assert.equal(manifest.exampleContentOnly, true);
    assert.equal(manifest.templates.length, 44);
    assert.equal(manifest.assets.length, 6);
    for (const asset of manifest.assets) {
      assert.match(asset.file, /^assets\/(?:sample-[a-z-]+\.jpg|(?:daily|weekly)-line-(?:light|dark)\.png)$/);
      assert.ok(asset.bytes < 70000);
    }
    for (const [file, expected] of Object.entries(manifest.files)) {
      const bytes = await readFile(resolve(output, file));
      assert.equal(bytes.length, expected.bytes, file);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), expected.sha256, file);
    }
    assert.ok((await readdir(resolve(output, "assets"))).includes("README.md"));
    const rendered = resolve(scratch, "rendered");
    execFileSync(process.execPath, [resolve(output, "render.mjs"), "weekly-performance", "--example", rendered], { cwd: output, stdio: "pipe" });
    const html = await readFile(resolve(rendered, "weekly-performance-standard-SAMPLE.html"), "utf8");
    const plain = await readFile(resolve(rendered, "weekly-performance-standard-SAMPLE.txt"), "utf8");
    assert.match(html, /<img\b/);
    assert.ok(plain.length > 200);
    assert.doesNotMatch(html, /<script\b|data:image\//i);
    assert.throws(() => execFileSync(process.execPath, [resolve(root, "scripts/email/export-library.mjs"), output], { cwd: root, stdio: "pipe" }), /Command failed/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
