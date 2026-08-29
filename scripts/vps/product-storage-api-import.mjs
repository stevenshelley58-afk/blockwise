#!/usr/bin/env node

// Import a reviewed five-field object manifest through Supabase Storage's
// public API contract. The file backend owns its tenant/version path and
// extended attributes; writing directly into its Docker volume is unsafe.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { lstat, open, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

const manifestValue = arg("--manifest");
const sourceValue = arg("--source-root");
const concurrency = Number.parseInt(arg("--concurrency") || "4", 10);
const rawStorageUrl = String(process.env.BLOCKWISE_STORAGE_URL || "").trim();
const serviceKey = String(process.env.BLOCKWISE_STORAGE_SERVICE_KEY || "").trim();
const globalFileSizeLimit = Number.parseInt(process.env.BLOCKWISE_STORAGE_FILE_SIZE_LIMIT || "10485760", 10);

if (!manifestValue || !sourceValue) {
  throw new Error("usage: product-storage-api-import.mjs --manifest <five-field.tsv> --source-root <objects> [--concurrency 4]");
}
if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) {
  throw new Error("concurrency must be an integer between 1 and 8");
}
if (!Number.isSafeInteger(globalFileSizeLimit) || globalFileSizeLimit < 1) {
  throw new Error("BLOCKWISE_STORAGE_FILE_SIZE_LIMIT must be a positive integer");
}
if (!serviceKey || serviceKey.length < 32 || /[\0\r\n]/u.test(serviceKey)) {
  throw new Error("BLOCKWISE_STORAGE_SERVICE_KEY is missing or invalid");
}

function storageBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("BLOCKWISE_STORAGE_URL must be a valid URL");
  }
  const isInternalHttp = url.protocol === "http:" && ["product-storage", "127.0.0.1", "localhost"].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" && !isInternalHttp)) {
    throw new Error("Storage import requires HTTPS or the private product-storage/loopback endpoint");
  }
  if (url.search || url.hash) throw new Error("BLOCKWISE_STORAGE_URL must not contain a query or fragment");
  const pathname = url.pathname.replace(/\/+$/u, "");
  if (pathname && pathname !== "/storage/v1") {
    throw new Error("BLOCKWISE_STORAGE_URL path must be empty or /storage/v1");
  }
  return `${url.origin}${pathname}`;
}

const storageUrl = storageBaseUrl(rawStorageUrl);
const manifestPath = resolve(manifestValue);
const sourceRoot = resolve(sourceValue);
if (!existsSync(manifestPath) || !existsSync(sourceRoot)) throw new Error("manifest or source root is missing");

function encodePath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function safeObjectName(value) {
  return Boolean(
    value &&
      !value.startsWith("/") &&
      !value.endsWith("/") &&
      !value.includes("\\") &&
      !/[\0\t\r\n]/u.test(value) &&
      value.split("/").every((segment) => segment && segment !== "." && segment !== ".."),
  );
}

function parseManifest(text) {
  const entries = [];
  const seen = new Set();
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (!line || line.startsWith("#")) continue;
    const fields = line.split("\t");
    if (fields.length !== 5) throw new Error(`manifest row ${index + 1} must contain exactly five fields`);
    const [bucket, objectName, sha256, byteSizeValue, mime] = fields;
    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(bucket)) throw new Error(`manifest row ${index + 1} has an unsafe bucket`);
    if (!safeObjectName(objectName)) throw new Error(`manifest row ${index + 1} has an unsafe object path`);
    if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new Error(`manifest row ${index + 1} has an invalid SHA-256`);
    const byteSize = Number(byteSizeValue);
    if (!Number.isSafeInteger(byteSize) || byteSize < 0) throw new Error(`manifest row ${index + 1} has an invalid byte size`);
    if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/iu.test(mime)) throw new Error(`manifest row ${index + 1} has an invalid MIME type`);
    const key = `${bucket}/${objectName}`;
    if (seen.has(key)) throw new Error(`duplicate object in manifest: ${key}`);
    seen.add(key);
    entries.push({ bucket, objectName, sha256, byteSize, mime });
  }
  if (entries.length === 0) throw new Error("object manifest is empty");
  return entries;
}

async function hashFile(path) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest("hex"), bytes };
}

async function sniffSupportedMime(path, mime) {
  const file = await open(path, "r");
  try {
    const sample = Buffer.alloc(16);
    const { bytesRead } = await file.read(sample, 0, sample.length, 0);
    const bytes = sample.subarray(0, bytesRead);
    if (mime === "image/png" && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
    if (mime === "image/jpeg" && !bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return false;
    if (mime === "image/webp" && !(bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP")) return false;
    if (mime === "font/woff2" && bytes.subarray(0, 4).toString("ascii") !== "wOF2") return false;
    return true;
  } finally {
    await file.close();
  }
}

async function preflight(entries) {
  const canonicalRoot = await realpath(sourceRoot);
  for (const entry of entries) {
    if (entry.byteSize > globalFileSizeLimit) {
      throw new Error(`source object exceeds the configured Storage limit: ${entry.bucket}/${entry.objectName}`);
    }
    const filePath = resolve(sourceRoot, entry.bucket, ...entry.objectName.split("/"));
    const fromRoot = relative(sourceRoot, filePath);
    if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error(`object escapes source root: ${entry.bucket}/${entry.objectName}`);
    }
    const fileInfo = await lstat(filePath).catch(() => null);
    if (!fileInfo?.isFile() || fileInfo.isSymbolicLink()) throw new Error(`source object is missing or not a regular file: ${entry.bucket}/${entry.objectName}`);
    const canonicalFile = await realpath(filePath);
    if (!canonicalFile.startsWith(`${canonicalRoot}${sep}`)) throw new Error(`source object escapes its canonical root: ${entry.bucket}/${entry.objectName}`);
    const actual = await stat(canonicalFile);
    if (actual.size !== entry.byteSize) throw new Error(`source byte-size mismatch: ${entry.bucket}/${entry.objectName}`);
    if (!(await sniffSupportedMime(canonicalFile, entry.mime))) throw new Error(`source MIME signature mismatch: ${entry.bucket}/${entry.objectName}`);
    const digest = await hashFile(canonicalFile);
    if (digest.sha256 !== entry.sha256 || digest.bytes !== entry.byteSize) throw new Error(`source checksum mismatch: ${entry.bucket}/${entry.objectName}`);
    entry.filePath = canonicalFile;
  }
}

const authHeaders = () => ({
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
});

async function request(path, init = {}, allowed = []) {
  const response = await fetch(`${storageUrl}/${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers || {}) },
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok && !allowed.includes(response.status)) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`${init.method || "GET"} storage ${path} failed ${response.status}: ${body}`);
  }
  return response;
}

async function hashResponse(response, expectedMime) {
  if (!response.body) throw new Error("Storage response has no body");
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
  if (contentType !== expectedMime.toLowerCase()) throw new Error(`target MIME mismatch: expected ${expectedMime}, received ${contentType || "none"}`);
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    hash.update(buffer);
    bytes += buffer.length;
  }
  return { sha256: hash.digest("hex"), bytes };
}

async function currentObject(entry) {
  const response = await request(`object/authenticated/${encodeURIComponent(entry.bucket)}/${encodePath(entry.objectName)}`, {}, [404]);
  if (response.status === 404) return null;
  return hashResponse(response, entry.mime);
}

async function importObject(entry) {
  // Re-read into an immutable request buffer immediately before any upsert.
  // The product limit is deliberately bounded, so this closes the path
  // replacement/mutation window without unbounded process memory.
  const sourceBytes = await readFile(entry.filePath);
  const sourceDigest = createHash("sha256").update(sourceBytes).digest("hex");
  if (sourceBytes.length !== entry.byteSize || sourceDigest !== entry.sha256) {
    throw new Error(`source changed after preflight: ${entry.bucket}/${entry.objectName}`);
  }
  const existing = await currentObject(entry);
  if (existing?.sha256 === entry.sha256 && existing.bytes === entry.byteSize) return "skipped";
  const upload = await request(`object/${encodeURIComponent(entry.bucket)}/${encodePath(entry.objectName)}`, {
    method: "POST",
    body: sourceBytes,
    headers: {
      "Content-Type": entry.mime,
      "Content-Length": String(entry.byteSize),
      "cache-control": "3600",
      "x-upsert": "true",
    },
  });
  await upload.arrayBuffer();
  const stored = await currentObject(entry);
  if (!stored || stored.sha256 !== entry.sha256 || stored.bytes !== entry.byteSize) {
    throw new Error(`target verification failed: ${entry.bucket}/${entry.objectName}`);
  }
  return existing ? "repaired" : "uploaded";
}

async function mapLimit(values, limit, worker) {
  let next = 0;
  const results = new Array(values.length);
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  }));
  return results;
}

async function listPrefix(bucket, prefix = "", visited = new Set()) {
  const visitKey = `${bucket}/${prefix}`;
  if (visited.has(visitKey)) throw new Error(`Storage list cycle detected in ${visitKey}`);
  visited.add(visitKey);
  const objects = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await request(`object/list/${encodeURIComponent(bucket)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error(`Storage list response for ${bucket}/${prefix} is invalid`);
    for (const item of page) {
      if (!item || typeof item.name !== "string" || !safeObjectName(item.name)) throw new Error(`Storage returned an unsafe name in ${bucket}/${prefix}`);
      const objectName = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id) objects.push(objectName);
      else objects.push(...await listPrefix(bucket, objectName, visited));
    }
    if (page.length < 1000) break;
  }
  return objects;
}

const manifestText = readFileSync(manifestPath, "utf8");
const entries = parseManifest(manifestText);
await preflight(entries);

const buckets = [...new Set(entries.map((entry) => entry.bucket))].sort();
for (const bucket of buckets) {
  const response = await request(`bucket/${encodeURIComponent(bucket)}`);
  const metadata = await response.json();
  if (!metadata || metadata.id !== bucket || metadata.name !== bucket || metadata.public !== false) {
    throw new Error(`target bucket must exist and remain private: ${bucket}`);
  }
  const bucketLimit = metadata.file_size_limit == null ? globalFileSizeLimit : Number(metadata.file_size_limit);
  if (!Number.isSafeInteger(bucketLimit) || bucketLimit < 1) throw new Error(`target bucket has an invalid file-size limit: ${bucket}`);
  const allowedMimes = metadata.allowed_mime_types;
  if (allowedMimes != null && (!Array.isArray(allowedMimes) || allowedMimes.some((mime) => typeof mime !== "string"))) {
    throw new Error(`target bucket has invalid MIME restrictions: ${bucket}`);
  }
  for (const entry of entries.filter((candidate) => candidate.bucket === bucket)) {
    if (entry.byteSize > bucketLimit) throw new Error(`source object exceeds the target bucket limit: ${bucket}/${entry.objectName}`);
    if (allowedMimes && !allowedMimes.includes(entry.mime)) throw new Error(`source MIME is not allowed by the target bucket: ${bucket}/${entry.objectName}`);
  }
}

let completed = 0;
const results = await mapLimit(entries, concurrency, async (entry) => {
  const result = await importObject(entry);
  completed += 1;
  if (completed % 25 === 0 || completed === entries.length) {
    process.stdout.write(`${JSON.stringify({ event: "product_storage_import_progress", complete: completed, total: entries.length })}\n`);
  }
  return result;
});

for (const bucket of buckets) {
  const expected = entries.filter((entry) => entry.bucket === bucket).map((entry) => entry.objectName).sort();
  const actual = (await listPrefix(bucket)).sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error(`target object-name reconciliation failed for ${bucket}: expected ${expected.length}, received ${actual.length}`);
  }
}

const counts = Object.fromEntries(["uploaded", "repaired", "skipped"].map((kind) => [kind, results.filter((result) => result === kind).length]));
const receipt = {
  status: "complete",
  objects: entries.length,
  bytes: entries.reduce((total, entry) => total + entry.byteSize, 0),
  buckets,
  manifestSha256: createHash("sha256").update(manifestText).digest("hex"),
  ...counts,
};
process.stdout.write(`blockwise-storage-import: complete ${JSON.stringify(receipt)}\n`);
