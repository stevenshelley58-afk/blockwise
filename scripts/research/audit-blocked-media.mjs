#!/usr/bin/env node
/**
 * audit-blocked-media.mjs — audit blocked media records before any redownload
 * (Ad Radar v2, plan §6). Do not blindly refill legacy media.
 *
 * Classifies every capture_status='blocked' media asset by:
 *   - parent ad lifecycle: currently active / seen recently / stale / unknown
 *   - source URL presence (fbcdn URLs expire; a dead URL needs a fresh
 *     capture through the creative's current source, not a retry)
 *   - age of the block
 * and writes a prioritized recapture report:
 *   P1: ad currently active with a source URL   -> recapture now
 *   P2: ad seen in the last 30 days             -> recapture next
 *   P3: everything else with a source URL       -> backlog, never blocking
 *   SKIP: no source URL and no stored bytes     -> dead provenance only
 *
 * With --reenqueue=N the top N P1/P2 assets are reset to capture_status
 * 'pending' so the existing media collector picks them up (it never proxies
 * media bytes through ScrapingBee).
 *
 * Usage:
 *   node scripts/research/audit-blocked-media.mjs [--report=out.json] [--reenqueue=200]
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--([a-z-]+)(?:=(.*))?$/iu.exec(arg);
  return match ? [match[1], match[2] === undefined ? true : match[2]] : [arg, true];
}));
const reportPath = args.report ? resolve(String(args.report)) : null;
const reenqueue = Number(args["reenqueue"] ?? 0);

const dbContainer = process.env.RESEARCH_DB_CONTAINER || "blockwise-research-db";
const psql = [
  "docker", "exec", "-i", dbContainer, "psql", "-U", "postgres",
  "-d", "blockwise_research", "-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-F", "\x1f",
];

function sqlRows(query) {
  const output = execFileSync(psql[0], psql.slice(1), { input: query, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return output.split("\n").filter((line) => line.length > 0).map((line) => line.split("\x1f"));
}

const columns = [
  "asset_id", "creative_id", "observed_ad_id", "kind", "source_url",
  "content_hash", "capture_status", "blocked_at", "ad_status",
  "last_seen_at", "ad_external_id",
];

const rows = sqlRows(`
  select
    ma.id::text,
    coalesce(ma.ad_creative_id::text, '') as creative_id,
    ma.observed_ad_id::text,
    ma.kind,
    coalesce(ma.source_url, '') as source_url,
    coalesce(ma.content_hash, '') as content_hash,
    ma.capture_status,
    coalesce(ma.updated_at::text, '') as blocked_at,
    coalesce(oa.active_status, 'no_parent_ad') as ad_status,
    coalesce(oa.last_seen_at::text, '') as last_seen_at,
    coalesce(oa.external_ad_id, '') as ad_external_id
  from research.media_assets ma
  left join research.observed_ads oa on oa.id = ma.observed_ad_id
  where ma.capture_status = 'blocked'
  order by oa.last_seen_at desc nulls last
`).map((row) => Object.fromEntries(columns.map((key, i) => [key, row[i]])));

const now = Date.now();
const day = 24 * 3_600_000;

function priorityOf(row) {
  if (!row.source_url) return "SKIP";
  const seenAt = row.last_seen_at ? Date.parse(row.last_seen_at) : NaN;
  const seenMsAgo = Number.isFinite(seenAt) ? now - seenAt : null;
  if (row.ad_status === "active") return "P1";
  if (seenMsAgo !== null && seenMsAgo <= 30 * day) return "P2";
  if (row.ad_status === "unknown" || seenMsAgo === null) return "P3";
  return "P3";
}

const audit = rows.map((row) => ({ ...row, priority: priorityOf(row) }));

const summary = {};
for (const item of audit) {
  summary[item.priority] = (summary[item.priority] || 0) + 1;
}
const byKind = {};
for (const item of audit) {
  byKind[item.kind] = byKind[item.kind] || {};
  byKind[item.kind][item.priority] = (byKind[item.kind][item.priority] || 0) + 1;
}

console.log(`Blocked media audited: ${audit.length}`);
console.log("By priority:", JSON.stringify(summary));
console.log("By kind/priority:", JSON.stringify(byKind, null, 2));

let reenqueued = 0;
if (reenqueue > 0) {
  const candidates = audit
    .filter((item) => item.priority === "P1" || item.priority === "P2")
    .slice(0, reenqueue);
  for (const item of candidates) {
    sqlRows(`update research.media_assets
      set capture_status = 'pending',
          updated_at = now(),
          metadata = metadata || '{"audit_reenqueue": "ad-radar-v2"}'::jsonb
      where id = '${item.asset_id}'::uuid and capture_status = 'blocked';`);
    reenqueued += 1;
  }
  console.log(`Re-enqueued ${reenqueued} prioritized asset(s) for the media collector.`);
}

const report = {
  ranAt: new Date().toISOString(),
  totalBlocked: audit.length,
  summary,
  byKind,
  note: "P1 = parent ad currently active; P2 = seen in last 30 days; P3 = backlog; SKIP = no source URL (dead provenance). Media bytes are never fetched through ScrapingBee.",
  reenqueued,
  prioritized: audit.filter((item) => item.priority !== "SKIP").slice(0, 500),
};

if (reportPath) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report written to ${reportPath}`);
}
