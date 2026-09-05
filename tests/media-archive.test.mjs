import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertSafeSourceUrl, downloadVerifiedMedia, writeVerifiedArchive } from "../hermes/tools/research-runtime/bin/media-archive.mjs";

const lookupPublic = async () => [{ address: "203.0.113.10", family: 4 }];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8xQAAAABJRU5ErkJggg==", "base64");
const mp4 = Buffer.from([0,0,0,20,102,116,121,112,105,115,111,109,0,0,0,0]);

function response(bytes, type) { return new Response(bytes, { headers: { "content-type": type, "content-length": String(bytes.length) } }); }

test("archives verified image and video bytes after source becomes unavailable", async () => {
  const root = mkdtempSync(join(tmpdir(), "ad-db-archive-"));
  try {
    const image = await downloadVerifiedMedia("https://cdn.example/image", { fetchImpl: async () => response(png, "image/png"), lookupImpl: lookupPublic });
    const imageArchive = await writeVerifiedArchive(root, image);
    const video = await downloadVerifiedMedia("https://cdn.example/video", { fetchImpl: async () => response(mp4, "video/mp4"), lookupImpl: lookupPublic });
    const videoArchive = await writeVerifiedArchive(root, video);
    await assert.rejects(() => downloadVerifiedMedia("https://cdn.example/image", { fetchImpl: async () => new Response(null, { status: 404 }), lookupImpl: lookupPublic }));
    assert.deepEqual(readFileSync(imageArchive.path), png);
    assert.deepEqual(readFileSync(videoArchive.path), mp4);
    assert.equal((await writeVerifiedArchive(root, image)).objectKey, imageArchive.objectKey);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("rejects private redirects, unsafe ports, MIME mismatch, and oversize bytes", async () => {
  await assert.rejects(() => assertSafeSourceUrl("http://127.0.0.1/x", async () => [{ address: "127.0.0.1", family: 4 }]));
  await assert.rejects(() => assertSafeSourceUrl("https://cdn.example:8080/x", lookupPublic));
  await assert.rejects(() => downloadVerifiedMedia("https://cdn.example/a", { fetchImpl: async () => response(png, "video/mp4"), lookupImpl: lookupPublic }));
  await assert.rejects(() => downloadVerifiedMedia("https://cdn.example/a", { maxBytes: 4, fetchImpl: async () => response(png, "image/png"), lookupImpl: lookupPublic }));
  await assert.rejects(() => downloadVerifiedMedia("https://cdn.example/a", { fetchImpl: async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }), lookupImpl: async (name) => [{ address: name === "127.0.0.1" ? "127.0.0.1" : "203.0.113.1", family: 4 }] }));
});
