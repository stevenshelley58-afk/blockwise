#!/usr/bin/env node

// Build the five-field migration manifest consumed by product-object-copy.sh.
// Object bytes are streamed locally so large buckets never enter process
// memory; the target import goes through the Storage API, never its volume.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const metadataValue = arg("--metadata");
const sourceValue = arg("--source-root");
const outValue = arg("--out");
if (!metadataValue || !sourceValue || !outValue) {
  throw new Error("usage: product-object-manifest.mjs --metadata <four-field.tsv> --source-root <objects> --out <five-field.tsv>");
}

const metadataPath = resolve(metadataValue);
const sourceRoot = resolve(sourceValue);
const outPath = resolve(outValue);
if (!existsSync(metadataPath) || !existsSync(sourceRoot)) throw new Error("metadata or source root is missing");

const sha256File = (path) => new Promise((resolveHash, reject) => {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("error", reject);
  stream.on("end", () => resolveHash(hash.digest("hex")));
});

const rows = readFileSync(metadataPath, "utf8").split(/\r?\n/u).filter(Boolean);
const seen = new Set();
const manifest = [];
let totalBytes = 0;
for (const [index, row] of rows.entries()) {
  const fields = row.split("\t");
  if (fields.length !== 4) throw new Error(`metadata row ${index + 1} must contain bucket, object path, byte size, and MIME`);
  const [bucket, objectPath, expectedBytesValue, mime] = fields;
  if (![bucket, objectPath, mime].every((value) => value && !/[\t\r\n]/u.test(value))) throw new Error(`metadata row ${index + 1} contains an unsafe field`);
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(bucket)) throw new Error(`metadata row ${index + 1} has an unsafe bucket`);
  const expectedBytes = Number(expectedBytesValue);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) throw new Error(`metadata row ${index + 1} has an invalid byte size`);
  const key = `${bucket}/${objectPath}`;
  if (seen.has(key)) throw new Error(`duplicate object metadata: ${key}`);
  seen.add(key);
  const filePath = resolve(sourceRoot, bucket, ...objectPath.split("/"));
  const fromRoot = relative(sourceRoot, filePath);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) throw new Error(`object escapes source root: ${key}`);
  if (!existsSync(filePath)) throw new Error(`downloaded object is missing: ${key}`);
  const actualBytes = statSync(filePath).size;
  if (actualBytes !== expectedBytes) throw new Error(`${key}: byte size ${actualBytes} does not match metadata ${expectedBytes}`);
  const sha256 = await sha256File(filePath);
  manifest.push(`${bucket}\t${objectPath}\t${sha256}\t${actualBytes}\t${mime}`);
  totalBytes += actualBytes;
}

writeFileSync(outPath, `${manifest.join("\n")}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ out: outPath, objects: manifest.length, bytes: totalBytes })}\n`);
