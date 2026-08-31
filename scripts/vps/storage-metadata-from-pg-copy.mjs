#!/usr/bin/env node

// Convert a pg_restore text COPY of storage.objects into the four-field
// metadata manifest consumed by product-object-manifest.mjs. Keeping this
// conversion offline avoids placing source database credentials in migration
// commands or logs.
import { createReadStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

const valuesFor = (name) => {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
};

const valueFor = (name) => valuesFor(name).at(-1) ?? null;
const sourceValue = valueFor("--copy-dump");
const outValue = valueFor("--out");
const includeEtag = process.argv.includes("--include-etag");
const buckets = new Set(valuesFor("--bucket").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean));

if (!sourceValue || !outValue || buckets.size === 0) {
  throw new Error("usage: storage-metadata-from-pg-copy.mjs --copy-dump <storage-objects.sql> --bucket <id> [--bucket <id>] --out <metadata.tsv>");
}
for (const bucket of buckets) {
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(bucket)) throw new Error(`unsafe bucket id: ${bucket}`);
}

function decodeCopyField(value) {
  if (value === String.raw`\N`) return null;
  return value.replace(/\\([btnrfv\\]|[0-7]{1,3})/gu, (match, escape) => {
    const named = { b: "\b", t: "\t", n: "\n", r: "\r", f: "\f", v: "\v", "\\": "\\" };
    if (Object.hasOwn(named, escape)) return named[escape];
    if (/^[0-7]{1,3}$/u.test(escape)) return String.fromCodePoint(Number.parseInt(escape, 8));
    return match;
  });
}

function copyColumns(line) {
  const match = /^COPY storage\.objects \(([^)]+)\) FROM stdin;$/u.exec(line);
  if (!match) return null;
  return match[1].split(",").map((column) => column.trim());
}

const sourcePath = resolve(sourceValue);
const outPath = resolve(outValue);
const input = createInterface({ input: createReadStream(sourcePath), crlfDelay: Infinity });
let columns = null;
let reading = false;
let copyFound = false;
const rows = [];
const seen = new Set();
const counts = new Map();
const bytes = new Map();

for await (const line of input) {
  if (!reading) {
    columns = copyColumns(line);
    if (columns) {
      reading = true;
      copyFound = true;
    }
    continue;
  }
  if (line === String.raw`\.`) break;

  const fields = line.split("\t").map(decodeCopyField);
  if (fields.length !== columns.length) throw new Error(`storage.objects COPY row has ${fields.length} fields; expected ${columns.length}`);
  const row = Object.fromEntries(columns.map((column, index) => [column, fields[index]]));
  if (!row.bucket_id || !buckets.has(row.bucket_id)) continue;
  if (!row.name || /[\t\r\n]/u.test(row.name)) throw new Error(`unsafe object path in ${row.bucket_id}`);

  let metadata;
  try {
    metadata = row.metadata ? JSON.parse(row.metadata) : {};
  } catch (error) {
    throw new Error(`${row.bucket_id}/${row.name}: invalid storage metadata JSON`, { cause: error });
  }
  const byteSize = Number(metadata.size ?? metadata.contentLength);
  const mime = typeof metadata.mimetype === "string" ? metadata.mimetype.trim() : "";
  const etag = String(metadata.eTag ?? "").replace(/\\/gu, "").replace(/^W\//u, "").replace(/^"+|"+$/gu, "").toLowerCase();
  if (!Number.isSafeInteger(byteSize) || byteSize < 0) throw new Error(`${row.bucket_id}/${row.name}: missing or invalid byte size`);
  if (!mime || /[\t\r\n]/u.test(mime)) throw new Error(`${row.bucket_id}/${row.name}: missing or unsafe MIME type`);
  if (includeEtag && !/^[a-f0-9]{32}(?:-[1-9][0-9]*)?$/u.test(etag)) throw new Error(`${row.bucket_id}/${row.name}: missing or invalid source ETag`);

  const key = `${row.bucket_id}/${row.name}`;
  if (seen.has(key)) throw new Error(`duplicate object metadata: ${key}`);
  seen.add(key);
  rows.push({ bucket: row.bucket_id, name: row.name, byteSize, mime, etag });
  counts.set(row.bucket_id, (counts.get(row.bucket_id) ?? 0) + 1);
  bytes.set(row.bucket_id, (bytes.get(row.bucket_id) ?? 0) + byteSize);
}

if (!copyFound) throw new Error("storage.objects COPY section was not found");
for (const bucket of buckets) {
  if (!counts.has(bucket)) throw new Error(`no storage objects found for bucket: ${bucket}`);
}

rows.sort((left, right) => left.bucket.localeCompare(right.bucket) || left.name.localeCompare(right.name));
writeFileSync(outPath, `${rows.map((row) => [row.bucket, row.name, row.byteSize, row.mime, ...(includeEtag ? [row.etag] : [])].join("\t")).join("\n")}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({
  out: outPath,
  objects: rows.length,
  bytes: rows.reduce((total, row) => total + row.byteSize, 0),
  buckets: [...buckets].sort().map((bucket) => ({ bucket, objects: counts.get(bucket), bytes: bytes.get(bucket) })),
})}\n`);
