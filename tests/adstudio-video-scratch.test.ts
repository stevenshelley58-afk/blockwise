import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

// Synchronous on purpose. The scratch root is read when the module first
// loads, and this suite must run under both node's type stripping and tsx,
// which compiles to CommonJS where top-level await is unavailable.
const scratchRoot = mkdtempSync(join(tmpdir(), "blockwise-scratch-test-"));
process.env.BLOCKWISE_VIDEO_SCRATCH_DIR = scratchRoot;

import {
  appendChunk,
  discardScratch,
  readHead,
  receivedBytes,
  scratchFilePath,
  VideoScratchError,
} from "../src/lib/adstudio/video-upload-scratch.ts";

const ASSET = "c0000000-0000-4000-8000-0000000000c1";

function body(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from([Buffer.from(bytes)])) as ReadableStream<Uint8Array>;
}

test("a non-uuid asset id is refused, so a scratch path cannot be steered", async () => {
  await assert.rejects(() => receivedBytes("../../etc/passwd"), VideoScratchError);
  await assert.rejects(() => receivedBytes("not-a-uuid"), VideoScratchError);
  assert.throws(() => scratchFilePath("../escape"), VideoScratchError);
});

test("an upload starts at offset zero and grows by the bytes written", async () => {
  assert.equal(await receivedBytes(ASSET), 0);
  const afterFirst = await appendChunk({ assetId: ASSET, expectedOffset: 0, body: body(new Uint8Array([1, 2, 3, 4])) });
  assert.equal(afterFirst, 4);
  const afterSecond = await appendChunk({ assetId: ASSET, expectedOffset: 4, body: body(new Uint8Array([5, 6])) });
  assert.equal(afterSecond, 6);
  assert.equal(await receivedBytes(ASSET), 6);
  await discardScratch(ASSET);
});

test("a chunk at the wrong offset is refused, which is what makes retry safe", async () => {
  await appendChunk({ assetId: ASSET, expectedOffset: 0, body: body(new Uint8Array([1, 2, 3, 4])) });
  // Replaying the same chunk must not double-append it.
  await assert.rejects(
    () => appendChunk({ assetId: ASSET, expectedOffset: 0, body: body(new Uint8Array([1, 2, 3, 4])) }),
    VideoScratchError,
  );
  assert.equal(await receivedBytes(ASSET), 4, "a replay must not change the file");
  await discardScratch(ASSET);
});

test("the recorded offset is what a resume continues from", async () => {
  await appendChunk({ assetId: ASSET, expectedOffset: 0, body: body(new Uint8Array([9, 9, 9])) });
  // Simulate a dropped connection: the client asks where to resume.
  const offset = await receivedBytes(ASSET);
  assert.equal(offset, 3);
  const resumed = await appendChunk({ assetId: ASSET, expectedOffset: offset, body: body(new Uint8Array([7, 7])) });
  assert.equal(resumed, 5);
  const head = await readHead(ASSET);
  assert.deepEqual([...head], [9, 9, 9, 7, 7], "resumed bytes append after the retained ones");
  await discardScratch(ASSET);
});

test("reading the head of a missing upload is empty rather than throwing", async () => {
  const head = await readHead("00000000-0000-4000-8000-0000000000ff");
  assert.equal(head.length, 0);
});

test("discarding is idempotent and leaves no offset behind", async () => {
  await appendChunk({ assetId: ASSET, expectedOffset: 0, body: body(new Uint8Array([1])) });
  await discardScratch(ASSET);
  await discardScratch(ASSET);
  assert.equal(await receivedBytes(ASSET), 0);
});

test("a missing chunk body is refused", async () => {
  await assert.rejects(
    () => appendChunk({ assetId: ASSET, expectedOffset: 0, body: null }),
    VideoScratchError,
  );
});
