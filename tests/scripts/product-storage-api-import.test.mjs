import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const importer = join(root, "scripts/vps/product-storage-api-import.mjs");
const serviceKey = "test-service-role-key-that-is-longer-than-thirty-two-characters";

function runImporter(args, storageUrl, extraEnv = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [importer, ...args], {
      cwd: root,
      env: {
        ...process.env,
        BLOCKWISE_STORAGE_URL: storageUrl,
        BLOCKWISE_STORAGE_SERVICE_KEY: serviceKey,
        BLOCKWISE_STORAGE_FILE_SIZE_LIMIT: "10485760",
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test("Storage API importer uploads, verifies, resumes, and repairs without exposing its credential", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "blockwise-product-storage-import-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const source = join(temp, "objects");
  const objectDir = join(source, "test-bucket", "folder");
  mkdirSync(objectDir, { recursive: true });
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("safe fixture")]);
  writeFileSync(join(objectDir, "a.png"), bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const manifest = join(temp, "manifest.tsv");
  writeFileSync(manifest, `test-bucket\tfolder/a.png\t${sha256}\t${bytes.length}\timage/png\n`);

  const stored = new Map();
  const uploads = [];
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.apikey, serviceKey);
    assert.equal(request.headers.authorization, `Bearer ${serviceKey}`);
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/bucket/test-bucket") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        id: "test-bucket",
        name: "test-bucket",
        public: false,
        file_size_limit: 10485760,
        allowed_mime_types: ["image/png"],
      }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/object/test-bucket/folder/a.png") {
      assert.equal(request.headers["x-upsert"], "true");
      assert.equal(request.headers["content-type"], "image/png");
      const uploaded = await readBody(request);
      stored.set("folder/a.png", uploaded);
      uploads.push(uploaded);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ Key: "test-bucket/folder/a.png" }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/object/authenticated/test-bucket/folder/a.png") {
      const value = stored.get("folder/a.png");
      if (!value) {
        response.statusCode = 404;
        response.end("missing");
        return;
      }
      response.setHeader("content-type", "image/png");
      response.end(value);
      return;
    }
    if (request.method === "POST" && url.pathname === "/object/list/test-bucket") {
      const query = JSON.parse((await readBody(request)).toString("utf8"));
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(query.prefix === "folder"
        ? [{ id: "object-1", name: "a.png" }]
        : [{ id: null, name: "folder" }]));
      return;
    }
    response.statusCode = 404;
    response.end("unexpected route");
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => server.close());
  const storageUrl = `http://127.0.0.1:${server.address().port}`;

  const first = await runImporter(["--manifest", manifest, "--source-root", source, "--concurrency", "2"], storageUrl);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /blockwise-storage-import: complete/);
  assert.match(first.stdout, /"uploaded":1/);
  assert.doesNotMatch(`${first.stdout}${first.stderr}`, new RegExp(serviceKey));
  assert.equal(uploads.length, 1);
  assert.deepEqual(stored.get("folder/a.png"), bytes);

  stored.set("folder/a.png", Buffer.concat([bytes.subarray(0, 8), Buffer.from("corrupt")]))
  const repaired = await runImporter(["--manifest", manifest, "--source-root", source], storageUrl);
  assert.equal(repaired.code, 0, repaired.stderr);
  assert.match(repaired.stdout, /"repaired":1/);
  assert.equal(uploads.length, 2);
  assert.deepEqual(stored.get("folder/a.png"), bytes);

  const resumed = await runImporter(["--manifest", manifest, "--source-root", source], storageUrl);
  assert.equal(resumed.code, 0, resumed.stderr);
  assert.match(resumed.stdout, /"skipped":1/);
  assert.equal(uploads.length, 2);
});

test("Storage API importer rejects traversal before making a request", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "blockwise-product-storage-traversal-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const source = join(temp, "objects");
  mkdirSync(source, { recursive: true });
  const manifest = join(temp, "manifest.tsv");
  writeFileSync(manifest, `test-bucket\t../escape.png\t${"0".repeat(64)}\t0\timage/png\n`);
  const result = await runImporter(["--manifest", manifest, "--source-root", source], "http://127.0.0.1:9");
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /unsafe object path/);
});

test("Storage API importer refuses a public destination bucket before upload", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "blockwise-product-storage-public-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const source = join(temp, "objects");
  const bucketDir = join(source, "test-bucket");
  mkdirSync(bucketDir, { recursive: true });
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("private")]);
  writeFileSync(join(bucketDir, "a.png"), bytes, { mode: 0o600 });
  const manifest = join(temp, "manifest.tsv");
  writeFileSync(manifest, `test-bucket\ta.png\t${createHash("sha256").update(bytes).digest("hex")}\t${bytes.length}\timage/png\n`, { mode: 0o600 });
  let uploads = 0;
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/bucket/test-bucket") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ id: "test-bucket", name: "test-bucket", public: true }));
      return;
    }
    uploads += 1;
    response.statusCode = 500;
    response.end("unexpected request");
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => server.close());
  const result = await runImporter(
    ["--manifest", manifest, "--source-root", source],
    `http://127.0.0.1:${server.address().port}`,
  );
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /must exist and remain private/);
  assert.equal(uploads, 0);
});
