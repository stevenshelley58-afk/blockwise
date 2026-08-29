import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "hermes", "tools", "research-runtime", "bin", "migrate-raw-evidence.mjs");

function runMigration(args) {
  const env = { ...process.env };
  for (const key of [
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "HERMES_CUSTOMER_SUPABASE_URL",
    "HERMES_CUSTOMER_SUPABASE_SECRET_KEY",
    "HERMES_CUSTOMER_SUPABASE_SERVICE_ROLE_KEY",
  ]) delete env[key];

  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });
}

test("streams, verifies, resumes, and repairs a storage bucket migration", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "blockwise-hermes-storage-"));
  const bytes = Buffer.from("safe bytes", "utf8");
  const etag = createHash("md5").update(bytes).digest("hex");
  let downloads = 0;
  const server = createServer((request, response) => {
    assert.equal(request.headers.apikey, "sb_secret_migration_test");
    if (request.method === "POST" && request.url === "/storage/v1/object/list/research-ad-creatives") {
      request.resume();
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify([{ id: "object-id", name: "asset.txt", metadata: { size: bytes.length, eTag: `\"${etag}\"`, mimetype: "text/plain" } }]));
      return;
    }
    if (request.method === "GET" && request.url === "/storage/v1/object/authenticated/research-ad-creatives/asset.txt") {
      downloads += 1;
      response.setHeader("content-type", "text/plain");
      response.end(bytes);
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });

  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const envFile = join(scratch, "source.env");
    const metadata = join(scratch, "metadata.tsv");
    const destination = join(scratch, "objects");
    writeFileSync(envFile, `SUPABASE_URL=http://127.0.0.1:${address.port}\nSUPABASE_SECRET_KEY=sb_secret_migration_test\nIGNORED_COMMAND=$(never-run)\n`);
    writeFileSync(metadata, `research-ad-creatives\tasset.txt\t${bytes.length}\ttext/plain\t${etag}\n`);
    const args = [
      "--env-file", envFile,
      "--bucket", "research-ad-creatives",
      "--metadata", metadata,
      "--destination-root", destination,
      "--concurrency", "1",
      "--expect-objects", "1",
      "--expect-bytes", String(bytes.length),
    ];

    const dryRun = await runMigration([...args, "--dry-run"]);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.deepEqual(JSON.parse(dryRun.stdout), {
      dryRun: true,
      bucket: "research-ad-creatives",
      objectCount: 1,
      totalBytes: bytes.length,
      destinationRoot: destination,
    });
    assert.equal(downloads, 0);

    const first = await runMigration(args);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).downloadedCount, 1);
    assert.equal(readFileSync(join(destination, "asset.txt"), "utf8"), "safe bytes");

    const second = await runMigration(args);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(JSON.parse(second.stdout).skippedCount, 1);
    assert.equal(downloads, 1);

    writeFileSync(join(destination, "asset.txt"), "bad bytes!");
    const repaired = await runMigration(args);
    assert.equal(repaired.status, 0, repaired.stderr);
    assert.equal(JSON.parse(repaired.stdout).downloadedCount, 1);
    assert.equal(readFileSync(join(destination, "asset.txt"), "utf8"), "safe bytes");
    assert.equal(downloads, 2);

    const manifest = JSON.parse(readFileSync(join(destination, "_migration-manifest.json"), "utf8"));
    assert.equal(manifest.version, 2);
    assert.equal(manifest.objects[0].sha256, createHash("sha256").update(bytes).digest("hex"));
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    rmSync(scratch, { recursive: true, force: true });
  }
});
