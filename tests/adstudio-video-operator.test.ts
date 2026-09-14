import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const code = (file: string) =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*import[\s\S]*?from\s+"[^"]+";?$/gm, "");

const queueApi = "src/app/api/operator/video-orders/route.ts";
const uploadApi = "src/app/api/operator/video-orders/upload/route.ts";
const queuePage = "src/app/(operator)/operator/video/page.tsx";
const queueComponent = "src/components/operator/video-queue.tsx";

test("the queue refuses a non-operator with the same answer as a missing page", () => {
  for (const file of [queueApi, uploadApi]) {
    const source = code(file);
    assert.match(source, /access\.isOperator/, `${file} must check the operator role`);
    assert.match(source, /status: 404/, `${file} must not reveal that the surface exists`);
  }
});

test("operator endpoints authorise before constructing a privileged client", () => {
  for (const file of [queueApi, uploadApi]) {
    const source = code(file);
    const guard = source.indexOf("requireApiWorkspace(");
    const client = source.indexOf("createSupabaseServiceClient(");
    assert.ok(guard >= 0, `${file} must authorise`);
    if (client >= 0) assert.ok(guard < client, `${file} must authorise before the service client`);
  }
});

test("the queue page refuses a non-operator", () => {
  const source = code(queuePage);
  assert.match(source, /access\.isOperator/);
  assert.match(source, /Not found/);
});

test("the queue shows paid orders only and never recomputes the deadline", () => {
  const source = readFileSync("src/lib/adstudio/video-fulfilment.ts", "utf8");
  assert.match(source, /\.eq\("payment_state", "paid"\)/);
  // The page must display the stored value, not derive a new one.
  const page = code(queuePage);
  assert.doesNotMatch(page, /nextWorkingDayDeadline|video_working_day_deadline|rpc\(/);
});

test("an operator can only attach a draft or a final through the upload route", () => {
  const source = code(uploadApi);
  assert.match(source, /body\.kind === "final" \? "final" : body\.kind === "draft" \? "draft" : null/);
  // Production material must never be reachable through an operator upload.
  assert.doesNotMatch(source, /production_source/);
});

test("an operator upload is inspected before it is stored", () => {
  const source = code(uploadApi);
  const inspect = source.indexOf("inspectVideoFile(");
  const store = source.indexOf(".upload(asset.object_path");
  assert.ok(inspect >= 0 && store >= 0);
  assert.ok(inspect < store, "media must be inspected before it is stored");
});

test("an operator upload is resumable on the same offset rules as a customer one", () => {
  const source = code(uploadApi);
  assert.match(source, /current !== expectedOffset/);
  assert.match(source, /appendChunk\(/);
});

test("an operator upload never overwrites an existing object", () => {
  const source = code(uploadApi);
  assert.match(source, /upsert: false/);
  assert.match(source, /crypto\.randomUUID\(\)/, "each upload gets a fresh identity");
});

test("the queue reloads recorded state rather than guessing at it", () => {
  const source = code(queueComponent);
  assert.match(source, /window\.location\.reload\(\)/);
  // No optimistic success copy: the row comes back from the server.
  assert.doesNotMatch(source, /optimistic/i);
});

test("the operator component uploads through the inspected path, not a direct write", () => {
  const source = code(queueComponent);
  assert.match(source, /\/api\/operator\/video-orders\/upload/);
  assert.doesNotMatch(source, /storage\/v1/, "the client must never write to storage directly");
});
