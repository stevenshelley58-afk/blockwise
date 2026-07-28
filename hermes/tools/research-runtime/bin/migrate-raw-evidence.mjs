#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import {
  hermesSupabaseHeaders,
  resolveHermesCustomerSupabaseCredential,
} from "./supabase-credentials.mjs";

const env = process.env;
const bucket = env.HERMES_RESEARCH_RAW_EVIDENCE_BUCKET || "research-raw-evidence";
const destinationRoot = resolve(env.HERMES_RAW_EVIDENCE_DIR || "/opt/research-raw-evidence");
const customerUrl = String(env.HERMES_CUSTOMER_SUPABASE_URL || env.SUPABASE_URL || "").replace(/\/+$/u, "");
const credential = resolveHermesCustomerSupabaseCredential(env);
const concurrency = Math.max(1, Math.min(12, Number.parseInt(env.HERMES_RAW_EVIDENCE_MIGRATION_CONCURRENCY || "6", 10)));

if (!customerUrl || !credential) {
  throw new Error("Customer Supabase credentials are required to migrate raw evidence.");
}

function encodePath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function destinationFor(objectName) {
  const destination = resolve(destinationRoot, objectName);
  if (destination !== destinationRoot && !destination.startsWith(`${destinationRoot}${sep}`)) {
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
      body: JSON.stringify({
        prefix,
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      }),
    });
    const page = await response.json();
    for (const entry of page) {
      const objectName = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) objects.push({ ...entry, objectName });
      else objects.push(...await listPrefix(objectName));
    }
    if (page.length < 1000) break;
  }
  return objects;
}

async function migrateObject(entry) {
  const destination = destinationFor(entry.objectName);
  const expectedSize = Number(entry.metadata?.size || 0);
  try {
    const existing = await stat(destination);
    if (expectedSize > 0 && existing.size === expectedSize) {
      return { name: entry.objectName, bytes: existing.size, skipped: true };
    }
  } catch {
    // Missing files are downloaded below.
  }

  const response = await storageRequest(`object/authenticated/${encodeURIComponent(bucket)}/${encodePath(entry.objectName)}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (expectedSize > 0 && buffer.length !== expectedSize) {
    throw new Error(`Size mismatch for ${entry.objectName}: expected ${expectedSize}, received ${buffer.length}`);
  }

  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.incomplete`;
  await writeFile(temporary, buffer, { mode: 0o600 });
  await rename(temporary, destination);
  return {
    name: entry.objectName,
    bytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    skipped: false,
  };
}

async function mapConcurrent(items, workerCount, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    for (;;) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

const entries = await listPrefix();
const migrated = await mapConcurrent(entries, concurrency, migrateObject);
const manifest = {
  version: 1,
  bucket,
  completedAt: new Date().toISOString(),
  objectCount: migrated.length,
  totalBytes: migrated.reduce((sum, entry) => sum + entry.bytes, 0),
  downloadedCount: migrated.filter((entry) => !entry.skipped).length,
  skippedCount: migrated.filter((entry) => entry.skipped).length,
  objects: migrated,
};
const manifestPath = resolve(destinationRoot, "_migration-manifest.json");
await mkdir(destinationRoot, { recursive: true });
await writeFile(`${manifestPath}.incomplete`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
await rename(`${manifestPath}.incomplete`, manifestPath);
console.log(JSON.stringify({
  bucket: manifest.bucket,
  objectCount: manifest.objectCount,
  totalBytes: manifest.totalBytes,
  downloadedCount: manifest.downloadedCount,
  skippedCount: manifest.skippedCount,
  manifestPath,
}));
