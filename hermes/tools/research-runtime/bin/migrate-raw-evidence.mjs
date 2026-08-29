#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, parse, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  hermesSupabaseHeaders,
  resolveHermesCustomerSupabaseCredential,
} from "./supabase-credentials.mjs";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

const allowedEnvFileKeys = new Set([
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "HERMES_CUSTOMER_SUPABASE_URL",
  "HERMES_CUSTOMER_SUPABASE_SECRET_KEY",
  "HERMES_CUSTOMER_SUPABASE_SERVICE_ROLE_KEY",
]);

async function loadMigrationEnv(baseEnv, envFile) {
  const merged = { ...baseEnv };
  if (envFile) {
    const text = await readFile(resolve(envFile), "utf8");
    for (const [lineNumber, original] of text.split(/\r?\n/u).entries()) {
      const line = original.trim();
      if (!line || line.startsWith("#")) continue;
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (!allowedEnvFileKeys.has(key) || merged[key]) continue;
      let value = rawValue.trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!value || /[\r\n\0]/u.test(value)) throw new Error(`invalid ${key} value on env-file line ${lineNumber + 1}`);
      merged[key] = value;
    }
  }
  merged.HERMES_CUSTOMER_SUPABASE_URL ||= merged.SUPABASE_URL;
  merged.HERMES_CUSTOMER_SUPABASE_SECRET_KEY ||= merged.SUPABASE_SECRET_KEY;
  merged.HERMES_CUSTOMER_SUPABASE_SERVICE_ROLE_KEY ||= merged.SUPABASE_SERVICE_ROLE_KEY;
  return merged;
}

const env = await loadMigrationEnv(process.env, arg("--env-file") || process.env.HERMES_STORAGE_MIGRATION_ENV_FILE);
const bucket = arg("--bucket") || env.HERMES_RESEARCH_RAW_EVIDENCE_BUCKET || "research-raw-evidence";
const destinationRoot = resolve(arg("--destination-root") || env.HERMES_RAW_EVIDENCE_DIR || "/opt/research-raw-evidence");
const customerUrl = String(env.HERMES_CUSTOMER_SUPABASE_URL || "").replace(/\/+$/u, "");
const credential = resolveHermesCustomerSupabaseCredential(env);
const concurrency = Math.max(1, Math.min(12, Number.parseInt(arg("--concurrency") || env.HERMES_RAW_EVIDENCE_MIGRATION_CONCURRENCY || "6", 10)));
const expectedObjects = Number.parseInt(arg("--expect-objects") || "0", 10);
const expectedBytes = Number.parseInt(arg("--expect-bytes") || "0", 10);
const dryRun = process.argv.includes("--dry-run");
const metadataPath = arg("--metadata");

if (!/^[a-z0-9][a-z0-9._-]*$/u.test(bucket)) throw new Error(`Unsafe storage bucket: ${bucket}`);
if (destinationRoot === parse(destinationRoot).root || destinationRoot === resolve(homedir())) {
  throw new Error(`Refusing broad migration destination: ${destinationRoot}`);
}
if (!customerUrl || !credential) throw new Error("Customer Supabase credentials are required to migrate storage objects.");
if (!/^https:\/\//u.test(customerUrl) && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(customerUrl)) {
  throw new Error("Storage migration source must use HTTPS unless it is loopback.");
}

function encodePath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function destinationFor(objectName) {
  const destination = resolve(destinationRoot, ...objectName.split("/"));
  if (destination === destinationRoot || !destination.startsWith(`${destinationRoot}${sep}`)) {
    throw new Error(`Unsafe storage object path: ${objectName}`);
  }
  return destination;
}

async function storageRequest(path, init = {}) {
  const response = await fetch(`${customerUrl}/storage/v1/${path}`, {
    ...init,
    headers: hermesSupabaseHeaders(credential, {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} storage ${path} failed ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  return response;
}

async function listPrefix(prefix = "") {
  const objects = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await storageRequest(`object/list/${encodeURIComponent(bucket)}`, {
      method: "POST",
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error(`Storage list response for ${prefix || "/"} was not an array`);
    for (const entry of page) {
      const objectName = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) objects.push({ ...entry, objectName });
      else objects.push(...await listPrefix(objectName));
    }
    if (page.length < 1000) break;
  }
  return objects;
}

async function entriesFromMetadata(path) {
  const entries = [];
  const seen = new Set();
  const rows = (await readFile(resolve(path), "utf8")).split(/\r?\n/u).filter(Boolean);
  for (const [index, row] of rows.entries()) {
    const fields = row.split("\t");
    if (fields.length !== 5) throw new Error(`metadata row ${index + 1} must contain bucket, object path, byte size, MIME, and source ETag`);
    const [rowBucket, objectName, byteSizeValue, mimetype, eTag] = fields;
    if (rowBucket !== bucket) throw new Error(`metadata row ${index + 1} belongs to unexpected bucket ${rowBucket}`);
    if (!objectName || /[\t\r\n]/u.test(objectName)) throw new Error(`metadata row ${index + 1} has an unsafe object path`);
    const byteSize = Number(byteSizeValue);
    if (!Number.isSafeInteger(byteSize) || byteSize < 0) throw new Error(`metadata row ${index + 1} has an invalid byte size`);
    if (!mimetype || /[\t\r\n]/u.test(mimetype)) throw new Error(`metadata row ${index + 1} has an unsafe MIME type`);
    if (!/^[a-f0-9]{32}(?:-[1-9][0-9]*)?$/u.test(eTag)) throw new Error(`metadata row ${index + 1} has an invalid source ETag`);
    if (seen.has(objectName)) throw new Error(`duplicate object metadata: ${objectName}`);
    seen.add(objectName);
    entries.push({ objectName, metadata: { size: byteSize, mimetype, eTag } });
  }
  return entries;
}

async function hashFile(path) {
  const sha256 = createHash("sha256");
  const md5 = createHash("md5");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    sha256.update(chunk);
    md5.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: sha256.digest("hex"), md5: md5.digest("hex") };
}

function sourceMd5(entry) {
  const value = String(entry.metadata?.eTag ?? "").replace(/\\/gu, "").replace(/^W\//u, "").replace(/^"+|"+$/gu, "").toLowerCase();
  return /^[a-f0-9]{32}$/u.test(value) ? value : null;
}

let previousManifestByName = new Map();

async function migrateObject(entry) {
  const destination = destinationFor(entry.objectName);
  const expectedSize = Number(entry.metadata?.size ?? entry.metadata?.contentLength ?? 0);
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) throw new Error(`Invalid size metadata for ${entry.objectName}`);
  try {
    const existing = await stat(destination);
    if (existing.isFile() && existing.size === expectedSize) {
      const verified = await hashFile(destination);
      const previous = previousManifestByName.get(entry.objectName);
      const matchesSource = sourceMd5(entry) ? verified.md5 === sourceMd5(entry) : previous?.sha256 === verified.sha256;
      if (matchesSource) {
        return { name: entry.objectName, bytes: verified.bytes, sha256: verified.sha256, sourceEtag: sourceMd5(entry), skipped: true };
      }
    }
  } catch {
    // Missing or mismatched files are downloaded below.
  }

  const response = await storageRequest(`object/authenticated/${encodeURIComponent(bucket)}/${encodePath(entry.objectName)}`);
  if (!response.body) throw new Error(`Storage download returned no body for ${entry.objectName}`);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.incomplete`;
  await rm(temporary, { force: true });
  const sha256 = createHash("sha256");
  const md5 = createHash("md5");
  let downloadedBytes = 0;
  const verifier = new Transform({
    transform(chunk, _encoding, callback) {
      sha256.update(chunk);
      md5.update(chunk);
      downloadedBytes += chunk.length;
      callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body), verifier, createWriteStream(temporary, { mode: 0o600 }));
    if (downloadedBytes !== expectedSize) {
      throw new Error(`Size mismatch for ${entry.objectName}: expected ${expectedSize}, received ${downloadedBytes}`);
    }
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  const downloadedMd5 = md5.digest("hex");
  if (sourceMd5(entry) && downloadedMd5 !== sourceMd5(entry)) {
    await rm(destination, { force: true });
    throw new Error(`Checksum mismatch for ${entry.objectName}`);
  }
  return {
    name: entry.objectName,
    bytes: downloadedBytes,
    sha256: sha256.digest("hex"),
    sourceEtag: sourceMd5(entry),
    skipped: false,
  };
}

async function mapConcurrent(items, workerCount, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let complete = 0;
  async function worker() {
    for (;;) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
      complete += 1;
      if (complete % 100 === 0 || complete === items.length) {
        process.stderr.write(`${JSON.stringify({ event: "storage_migration_progress", bucket, complete, total: items.length })}\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

await mkdir(destinationRoot, { recursive: true });
const previousManifestPath = resolve(destinationRoot, "_migration-manifest.json");
try {
  const previous = JSON.parse(await readFile(previousManifestPath, "utf8"));
  if (previous?.bucket === bucket && Array.isArray(previous.objects)) {
    previousManifestByName = new Map(previous.objects.filter((entry) => entry?.name && entry?.sha256).map((entry) => [entry.name, entry]));
  }
} catch {
  // A missing or invalid prior manifest never authorises a size-only skip.
}
const entries = metadataPath ? await entriesFromMetadata(metadataPath) : await listPrefix();
const listedBytes = entries.reduce((sum, entry) => sum + Number(entry.metadata?.size ?? entry.metadata?.contentLength ?? 0), 0);
if (expectedObjects > 0 && entries.length !== expectedObjects) throw new Error(`Object count mismatch: expected ${expectedObjects}, listed ${entries.length}`);
if (expectedBytes > 0 && listedBytes !== expectedBytes) throw new Error(`Byte count mismatch: expected ${expectedBytes}, listed ${listedBytes}`);
if (dryRun) {
  process.stdout.write(`${JSON.stringify({ dryRun: true, bucket, objectCount: entries.length, totalBytes: listedBytes, destinationRoot })}\n`);
  process.exit(0);
}

const migrated = await mapConcurrent(entries, concurrency, migrateObject);
const manifest = {
  version: 2,
  bucket,
  completedAt: new Date().toISOString(),
  objectCount: migrated.length,
  totalBytes: migrated.reduce((sum, entry) => sum + entry.bytes, 0),
  downloadedCount: migrated.filter((entry) => !entry.skipped).length,
  skippedCount: migrated.filter((entry) => entry.skipped).length,
  objects: migrated,
};
if (expectedObjects > 0 && manifest.objectCount !== expectedObjects) throw new Error("Final object count did not match the source manifest");
if (expectedBytes > 0 && manifest.totalBytes !== expectedBytes) throw new Error("Final byte count did not match the source manifest");

const manifestPath = resolve(destinationRoot, "_migration-manifest.json");
await writeFile(`${manifestPath}.incomplete`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
await rename(`${manifestPath}.incomplete`, manifestPath);
process.stdout.write(`${JSON.stringify({
  bucket: manifest.bucket,
  objectCount: manifest.objectCount,
  totalBytes: manifest.totalBytes,
  downloadedCount: manifest.downloadedCount,
  skippedCount: manifest.skippedCount,
  manifestPath,
})}\n`);
