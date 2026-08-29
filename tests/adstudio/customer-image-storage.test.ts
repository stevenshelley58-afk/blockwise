import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CustomerImageStorageError,
  resolveCustomerImageValues,
} from "../../src/lib/adstudio/customer-image-storage.ts";
import { buildCustomerImageRef, imageSha256 } from "../../src/lib/adstudio/customer-image-ref.ts";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const workspaceId = "workspace-test";
const adId = "ad-test";
const dataUrl = `data:image/png;base64,${png.toString("base64")}`;

function fakeSupabase(initial: Map<string, Buffer> = new Map(), failUpload = false) {
  const objects = new Map(initial);
  const uploads: Array<{ path: string; bytes: Buffer; options: Record<string, unknown> }> = [];
  const removals: string[][] = [];
  const storage = {
    from: (bucket: string) => {
      assert.equal(bucket, "adstudio-customer-images");
      return {
        upload: async (path: string, bytes: Buffer, options: Record<string, unknown>) => {
          uploads.push({ path, bytes: Buffer.from(bytes), options });
          objects.set(path, Buffer.from(bytes));
          if (failUpload) return { data: null, error: { message: "simulated upload failure" } };
          return { data: { path }, error: null };
        },
        download: async (path: string) => {
          const bytes = objects.get(path);
          return bytes
            ? { data: new Blob([new Uint8Array(bytes)]), error: null }
            : { data: null, error: { message: "not found" } };
        },
        remove: async (paths: string[]) => {
          removals.push(paths);
          for (const path of paths) objects.delete(path);
          return { data: paths.map((path) => ({ name: path })), error: null };
        },
      };
    },
  };
  return { client: { storage } as never, objects, uploads, removals };
}

test("uploads valid customer PNGs to the exact content-addressed workspace/ad path", async () => {
  const fake = fakeSupabase();
  const result = await resolveCustomerImageValues({ hero: dataUrl }, workspaceId, adId, fake.client);
  const hash = imageSha256(png);
  const expectedPath = `${workspaceId}/adstudio/ads/${adId}/images/${hash}.png`;

  assert.deepEqual(result.bytes.hero, png);
  assert.equal(fake.uploads.length, 1);
  assert.equal(fake.uploads[0].path, expectedPath);
  assert.equal(fake.uploads[0].options.contentType, "image/png");
  assert.equal(fake.uploads[0].options.upsert, true);
  assert.equal(result.refs.hero, buildCustomerImageRef(workspaceId, adId, hash, "image/png"));
  assert.doesNotMatch(result.refs.hero, /base64|data:image/i);
});

test("same input is deterministic and idempotent", async () => {
  const fake = fakeSupabase();
  const first = await resolveCustomerImageValues({ hero: dataUrl }, workspaceId, adId, fake.client);
  const second = await resolveCustomerImageValues({ hero: dataUrl }, workspaceId, adId, fake.client);
  assert.equal(first.refs.hero, second.refs.hero);
  assert.equal(fake.uploads.length, 2);
  assert.equal(fake.uploads[0].path, fake.uploads[1].path);
  assert.equal(fake.uploads[1].options.upsert, true);
});

test("existing refs download and verify bytes without uploading", async () => {
  const hash = imageSha256(png);
  const ref = buildCustomerImageRef(workspaceId, adId, hash, "image/png");
  const fake = fakeSupabase(new Map([[`${workspaceId}/adstudio/ads/${adId}/images/${hash}.png`, png]]));
  const result = await resolveCustomerImageValues({ hero: ref }, workspaceId, adId, fake.client);
  assert.deepEqual(result.bytes.hero, png);
  assert.equal(result.refs.hero, ref);
  assert.equal(fake.uploads.length, 0);
});

test("cross-scope and tampered refs reject with a generic storage error", async () => {
  const hash = imageSha256(png);
  const validPath = `${workspaceId}/adstudio/ads/${adId}/images/${hash}.png`;
  const fake = fakeSupabase(new Map([[validPath, png]]));
  const wrongWorkspace = buildCustomerImageRef("other-workspace", adId, hash, "image/png");
  const wrongAd = buildCustomerImageRef(workspaceId, "other-ad", hash, "image/png");
  const tamperedHash = createHash("sha256").update("different").digest("hex");
  const tampered = buildCustomerImageRef(workspaceId, adId, tamperedHash, "image/png");

  for (const value of [wrongWorkspace, wrongAd, tampered]) {
    await assert.rejects(
      resolveCustomerImageValues({ hero: value }, workspaceId, adId, fake.client),
      (error: unknown) => error instanceof CustomerImageStorageError
        && error.message === "Customer image could not be stored or loaded."
        && !error.message.includes(hash),
    );
  }
});

test("failed uploads remove any partially written object", async () => {
  const fake = fakeSupabase(new Map(), true);

  await assert.rejects(
    resolveCustomerImageValues({ hero: dataUrl }, workspaceId, adId, fake.client),
    (error: unknown) => error instanceof CustomerImageStorageError,
  );
  assert.equal(fake.removals.length, 1);
  assert.equal(fake.objects.size, 0);
});
