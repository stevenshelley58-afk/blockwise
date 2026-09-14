import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(file, "utf8");

const uploadsRoute = "src/app/api/adstudio/videos/uploads/route.ts";
const uploadIdRoute = "src/app/api/adstudio/videos/uploads/[uploadId]/route.ts";
const mediaRoute = "src/app/api/adstudio/videos/media/route.ts";
const videosRoute = "src/app/api/adstudio/videos/route.ts";

/**
 * Call site, not the import of the same name. `await` is included so these
 * patterns cannot match an import specifier or a type reference.
 */
const callSite = (source: string, needle: string) => source.indexOf(`await ${needle}`);

test("every video route authorises the workspace before doing any work", () => {
  for (const file of [uploadsRoute, uploadIdRoute, mediaRoute, videosRoute]) {
    const source = read(file);
    const guard = source.indexOf('await requireApiWorkspace(');
    assert.ok(guard >= 0, `${file} must await requireApiWorkspace`);

    // The guard must come before privileged clients, storage or ledger work.
    for (const danger of [
      "createSupabaseServiceClient()",
      "initiateUpload(",
      "finaliseUpload(",
      "checkRateLimit(",
    ]) {
      const at = callSite(source, danger);
      if (at >= 0) {
        assert.ok(guard < at, `${file} must authorise before ${danger}`);
      }
    }
  }
});

test("upload start creates no payment record", () => {
  for (const file of [uploadsRoute, uploadIdRoute]) {
    const source = read(file);
    assert.doesNotMatch(source, /video_payment_attempts/, `${file} must not touch payment attempts`);
    assert.doesNotMatch(source, /video_orders/, `${file} must not touch orders`);
    assert.doesNotMatch(source, /stripe/i, `${file} must not reach Stripe`);
  }
});

test("the media route refuses a path outside the caller's workspace", () => {
  const source = read(mediaRoute);
  assert.match(source, /isPathInWorkspace\(objectPath, workspaceId\)/);
  // The stored path must match the record, so a swapped path cannot be used.
  assert.match(source, /asset\.object_path !== objectPath/);
});

test("the media route hides operator-only and unvalidated material", () => {
  const source = read(mediaRoute);
  assert.match(source, /asset\.visibility !== "customer" && !operator/);
  assert.match(source, /asset\.upload_state !== "ready" && !operator/);
});

test("the media route issues short-lived links and never caches them", () => {
  const source = read(mediaRoute);
  const ttl = /SIGNED_URL_TTL_SECONDS = (\d+)/.exec(source);
  assert.ok(ttl, "the signed link must have a declared lifetime");
  assert.ok(Number(ttl[1]) <= 600, `signed link lifetime too long: ${ttl[1]}s`);
  assert.match(source, /no-store/);
  assert.doesNotMatch(source, /console\.log/, "a bearer link must never be logged");
});

test("a chunk is only applied at the expected offset", () => {
  const source = read(uploadIdRoute);
  assert.match(source, /current !== expectedOffset/, "a mismatched offset must be refused");
  assert.match(source, /expectedOffset/);
});

test("finalisation inspects before it stores and settles the ledger afterwards", () => {
  const source = read(uploadIdRoute);
  const inspect = callSite(source, "inspectVideoFile(");
  // Storage upload is a chained call, so match the chain rather than an await.
  const store = source.indexOf(".upload(upload.object_path");
  // There are two settle sites and both are correct in a different order:
  //   * rejection -> settle as rejected, nothing is stored
  //   * success   -> inspect, store, then settle ready
  // Only the success path is asserted here, so use the LAST settle, which is
  // the success one, and require the object to exist before it.
  const settle = source.lastIndexOf("await finaliseUpload(");
  assert.ok(inspect >= 0, "finalisation must inspect the file");
  assert.ok(store >= 0, "finalisation must store the file");
  assert.ok(settle >= 0, "finalisation must settle the ledger");
  assert.ok(inspect < store, "media must be inspected before it is stored");
  assert.ok(store < settle, "the object must exist before the ledger is marked ready");
});

test("a rejected upload settles the ledger without storing anything", () => {
  const source = read(uploadIdRoute);
  const start = source.indexOf("if (!inspection.ok)");
  // Bound the branch at the point the success path begins, so this asserts the
  // rejection path itself rather than the whole remainder of the handler.
  const end = source.indexOf("let blob: Blob;");
  assert.ok(start >= 0 && end > start, "the rejection branch must be locatable");
  const rejectBranch = source.slice(start, end);

  assert.ok(
    rejectBranch.includes("await finaliseUpload("),
    "a rejected upload must still be recorded",
  );
  assert.ok(
    !rejectBranch.includes(".upload("),
    "a rejected upload must never be written to the bucket",
  );
  assert.ok(
    rejectBranch.includes("discardScratch(uploadId)"),
    "a rejected upload must discard its scratch bytes",
  );
});

test("a rejected upload is marked rejected and its scratch copy removed", () => {
  const source = read(uploadIdRoute);
  assert.match(source, /if \(!inspection\.ok\)/);
  assert.match(source, /discardScratch\(uploadId\)/);
  assert.match(source, /status: 422/);
});

test("an already-settled upload is reported, not re-inspected", () => {
  const source = read(uploadIdRoute);
  assert.match(source, /upload\.upload_state === "ready" \|\| upload\.upload_state === "rejected"/);
});

test("a failed ledger settle removes the object rather than orphaning it", () => {
  const source = read(uploadIdRoute);
  assert.match(source, /\.remove\(\[upload\.object_path\]\)/);
});

test("uploads never reach object storage directly from the browser", () => {
  const source = read(uploadsRoute);
  assert.doesNotMatch(source, /createSignedUploadUrl/, "no direct-to-storage upload credentials are issued");
});

test("a partial file is never treated as complete", () => {
  const source = read(uploadIdRoute);
  assert.match(source, /body\.totalBytes !== size/);
  assert.match(source, /The upload is incomplete/);
});
