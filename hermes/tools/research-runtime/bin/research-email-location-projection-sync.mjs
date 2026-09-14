#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildCustomerRest,
  buildEmailLocationProjections,
  EMAIL_LOCATION_SOURCE,
  readAll,
} from "./customer-read-model-publisher.mjs";
import {
  hermesSupabaseHeaders,
  resolveHermesSupabaseCredential,
} from "./supabase-credentials.mjs";

const AGENT_SELECT = "id,email,primary_postcode,primary_suburb,metadata,updated_at";

function cleanUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/u, "");
}

export function loadKnownPostcodes() {
  const rows = JSON.parse(readFileSync(new URL("../../../data/au-postcodes.json", import.meta.url), "utf8"));
  return new Set(rows.map((row) => String(row.postcode ?? "")).filter((postcode) => /^\d{4}$/u.test(postcode)));
}

export function buildResearchRest(env, fetchImpl) {
  const url = cleanUrl(env.HERMES_SUPABASE_URL);
  const credential = resolveHermesSupabaseCredential(env);
  if (!url || !credential) return null;

  return async function researchRest(schema, path, init = {}) {
    const response = await fetchImpl(`${url}/rest/v1/${path}`, {
      ...init,
      headers: hermesSupabaseHeaders(credential, {
        "Accept-Profile": schema,
        "Content-Profile": schema,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${init.method || "GET"} research projection source failed ${response.status}`);
    }
    return text ? JSON.parse(text) : null;
  };
}

export async function syncResearchEmailLocationProjection({
  env = process.env,
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
  createRevision = randomUUID,
  knownPostcodes = loadKnownPostcodes(),
  dryRun = false,
} = {}) {
  const researchRest = buildResearchRest(env, fetchImpl);
  const customerRest = buildCustomerRest(env, fetchImpl);
  if (!researchRest) throw new Error("research projection source is not configured");
  if (!customerRest && !dryRun) throw new Error("customer projection target is not configured");

  const snapshotAt = now();
  if (!Number.isFinite(Date.parse(snapshotAt))) throw new Error("snapshot clock returned an invalid timestamp");
  const agentRows = await readAll(
    researchRest,
    "agents",
    AGENT_SELECT,
    "order=id.asc",
    "id",
  );

  const revision = createRevision();
  const projections = buildEmailLocationProjections(
    agentRows,
    revision,
    snapshotAt,
    knownPostcodes,
  );
  const rows = projections.map(({ email_sha256, postcode, suburb, source_observed_at }) => ({
    email_sha256,
    postcode,
    suburb,
    source_observed_at,
  }));

  if (dryRun) {
    return { status: "dry_run", sourceRows: agentRows.length, projectedRows: rows.length };
  }

  const result = await customerRest("rpc/replace_research_email_location_projection_snapshot", {
    method: "POST",
    body: JSON.stringify({
      p_source: EMAIL_LOCATION_SOURCE,
      p_snapshot_at: snapshotAt,
      p_source_revision: revision,
      p_rows: rows,
      p_allow_large_removal: false,
    }),
  });
  if (!result || typeof result.applied !== "boolean") {
    throw new Error("projection target returned an invalid snapshot result");
  }
  if (!result.applied && result.reason !== "stale_snapshot") {
    throw new Error(`projection snapshot rejected: ${String(result.reason || "unknown")}`);
  }
  return {
    status: result.applied ? "applied" : "stale_snapshot",
    revision,
    sourceRows: agentRows.length,
    projectedRows: rows.length,
    removedRows: Number(result.removed_rows || 0),
  };
}

async function main() {
  const allowed = new Set(["--dry-run"]);
  const unknown = process.argv.slice(2).filter((argument) => !allowed.has(argument));
  if (unknown.length > 0) throw new Error(`unknown argument: ${unknown[0]}`);
  const result = await syncResearchEmailLocationProjection({ dryRun: process.argv.includes("--dry-run") });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`research email location projection failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
