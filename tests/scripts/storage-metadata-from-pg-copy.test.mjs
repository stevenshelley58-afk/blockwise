import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "vps", "storage-metadata-from-pg-copy.mjs");

const header = "COPY storage.objects (id, bucket_id, name, metadata) FROM stdin;\n";

test("extracts selected storage metadata from a pg COPY without database access", () => {
  const scratch = mkdtempSync(join(tmpdir(), "blockwise-storage-copy-"));
  try {
    const source = join(scratch, "storage.sql");
    const out = join(scratch, "metadata.tsv");
    writeFileSync(source, `${header}1\tworkspace-artifacts\tfolder/one.png\t{\"size\": 10, \"mimetype\": \"image/png\", \"eTag\": \"cdfafa210a5f3a36b31941f2a1c392b0\"}\n2\tresearch-ad-creatives\tmedia\\040blob.jpg\t{\"contentLength\": 12, \"mimetype\": \"image/jpeg\", \"eTag\": \"5d41402abc4b2a76b9719d911017c592\"}\n\\.\n`);

    const result = spawnSync(process.execPath, [SCRIPT, "--copy-dump", source, "--bucket", "research-ad-creatives", "--include-etag", "--out", out], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      out,
      objects: 1,
      bytes: 12,
      buckets: [{ bucket: "research-ad-creatives", objects: 1, bytes: 12 }],
    });
    assert.equal(readFileSync(out, "utf8"), "research-ad-creatives\tmedia blob.jpg\t12\timage/jpeg\t5d41402abc4b2a76b9719d911017c592\n");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("fails closed for duplicate objects and malformed metadata", () => {
  const scratch = mkdtempSync(join(tmpdir(), "blockwise-storage-copy-bad-"));
  try {
    const source = join(scratch, "storage.sql");
    const out = join(scratch, "metadata.tsv");
    writeFileSync(source, `${header}1\tresearch-ad-creatives\tasset.png\t{\"size\": 10, \"mimetype\": \"image/png\"}\n2\tresearch-ad-creatives\tasset.png\t{\"size\": 10, \"mimetype\": \"image/png\"}\n\\.\n`);
    const duplicate = spawnSync(process.execPath, [SCRIPT, "--copy-dump", source, "--bucket", "research-ad-creatives", "--out", out], { encoding: "utf8" });
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /duplicate object metadata/u);

    writeFileSync(source, `${header}1\tresearch-ad-creatives\tasset.png\t{}\n\\.\n`);
    const malformed = spawnSync(process.execPath, [SCRIPT, "--copy-dump", source, "--bucket", "research-ad-creatives", "--out", out], { encoding: "utf8" });
    assert.notEqual(malformed.status, 0);
    assert.match(malformed.stderr, /missing or invalid byte size/u);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
