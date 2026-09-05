#!/usr/bin/env node
/**
 * record-migration-ledger.mjs — record an applied research migration in
 * research.schema_migration_ledger with its sha256 checksum.
 *
 * Usage:
 *   node scripts/research/record-migration-ledger.mjs <migration-file> [note]
 *
 * The migration must already have been applied; this records that fact. The
 * checksum is computed from the file on disk so later edits are detectable
 * (tests/meta-ad-lifecycle-migration.test.mjs re-verifies the checksums).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/research/record-migration-ledger.mjs <migration-file> [note]");
  process.exit(2);
}

const path = resolve(file);
const name = path.split("/").pop();
const version = name.split("_", 1)[0];
if (!/^\d{8,}$/.test(version)) {
  console.error(`Cannot derive a version from file name: ${name}`);
  process.exit(2);
}
const checksum = createHash("sha256").update(readFileSync(path)).digest("hex");
const note = process.argv[3] || null;

const dbContainer = process.env.RESEARCH_DB_CONTAINER || "blockwise-research-db";
const psqlPrefix = process.env.RESEARCH_DB_PSQL
  ? String(process.env.RESEARCH_DB_PSQL).split(" ")
  : ["docker", "exec", "-i", dbContainer, "psql", "-U", "postgres", "-d", "blockwise_research", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t"];

const existing = execFileSync(psqlPrefix[0], psqlPrefix.slice(1), {
  input: `select checksum from research.schema_migration_ledger where version = '${version}';`,
  encoding: "utf8",
}).trim();

if (existing) {
  if (existing !== checksum) {
    console.error(`MISMATCH: ledger checksum for ${version} is ${existing}, file on disk is ${checksum}.`);
    process.exit(3);
  }
  console.log(`${version} already recorded with matching checksum.`);
  process.exit(0);
}

const insert = `insert into research.schema_migration_ledger (version, name, checksum, applied_by, note)
values ('${version}', '${name}', '${checksum}', 'manual', ${note ? `'${note.replaceAll("'", "''")}'` : "null"});`;
execFileSync(psqlPrefix[0], psqlPrefix.slice(1), { input: insert, encoding: "utf8" });
console.log(`Recorded ${version} (${name}) in research.schema_migration_ledger.`);
