#!/usr/bin/env node
/**
 * Import the fixture TemplatePack into a Blockwise Supabase project so the
 * Ad Studio gallery is not empty on local/preview deployments.
 *
 * This is the dev/admin seed path for the signed import pipeline
 * (src/lib/adstudio/import-pack.ts). It uses the same test/local injection
 * point the import tests use — `fetchPack` — so the pack bytes come straight
 * from the fixture JSON on disk instead of a live Frank URL, and the
 * HTTPS + origin allowlist is skipped (the operator vouches for the source).
 *
 * The current pack format is a JSON document (canonical-JSON hashed), not a
 * zip container — the fixture JSON *is* the pack. The same helpers the tests
 * use (sha256Hex from the ad-template-pack-contract package, fetchPack
 * injection) are reused here.
 *
 * Signature note: `importTemplatePack` stores `signature` but real Ed25519
 * verification is a Phase 5 placeholder (commented out in import-pack.ts), so
 * no key is needed today. When verification lands it will use the Frank
 * public key (env FRANK_PACK_PUBLIC_KEY); this script's placeholder signature
 * will then need a real fixture signature.
 *
 * Safety:
 *  - Requires --yes to write anything (no interactive prompt).
 *  - --help and --dry-run touch neither the network nor the database.
 *  - Reads credentials from the environment only; never commits secrets.
 *  - Idempotent: re-running with the same pack hash returns a "replayed"
 *    receipt instead of duplicating rows.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "../lib/supabase-server-credential.mjs";
import { sha256Hex, verifyManifestHash } from "../../packages/ad-template-pack-contract/src/hash.ts";
import { templatePackSchema } from "../../packages/ad-template-pack-contract/src/schema.ts";
import { importTemplatePack } from "../../src/lib/adstudio/import-pack.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const DEFAULT_FIXTURE = join(REPO_ROOT, "tests", "fixtures", "template-pack", "minimal-feed-story.json");
const PACK_URL = "https://frank.fail/packs/fixture-minimal.json";

const USAGE = `Import the fixture TemplatePack so the Ad Studio gallery is not empty.

Usage:
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \\
    scripts/adstudio/import-fixture-pack.mjs [options]

Options:
  -h, --help            Show this help and exit (no env or DB access).
      --dry-run         Validate env + fixture and print the import plan; write nothing.
      --yes             Actually import. Without --yes the script only prints the plan.
      --pack-id <id>    Override packId (default: the pack's packId field).
      --build-id <id>   Override buildId (default: fixture-import-<ISO timestamp>).
      --nonce <uuid>    Override nonce (default: a random UUID).
      --fixture <path>  Path to the fixture pack JSON
                        (default: tests/fixtures/template-pack/minimal-feed-story.json).

Environment (service-role credential of the TARGET project — local or preview):
  NEXT_PUBLIC_SUPABASE_URL  or  SUPABASE_URL
  SUPABASE_SECRET_KEY (preferred)  or  SUPABASE_SERVICE_ROLE_KEY (legacy)

Examples:
  # Local Supabase (start it first: supabase start)
  node --env-file=.env.local --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \\
    scripts/adstudio/import-fixture-pack.mjs --yes

  # Preview (service-role env of the preview project, never committed)
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \\
  node scripts/adstudio/import-fixture-pack.mjs --yes

See scripts/adstudio/README.md for details.`;

// ---------------------------------------------------------------------------
// Arg parsing (tiny, no deps)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    help: false,
    dryRun: false,
    yes: false,
    packId: undefined,
    buildId: undefined,
    nonce: undefined,
    fixture: undefined,
  };
  const takeValue = (flag, inline) => {
    if (inline !== undefined) return inline;
    const next = argv.shift();
    if (next === undefined) throw new Error(`Missing value for ${flag}`);
    return next;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq >= 0 ? arg.slice(0, eq) : arg;
    const inline = eq >= 0 ? arg.slice(eq + 1) : undefined;
    switch (flag) {
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--yes":
        opts.yes = true;
        break;
      case "--pack-id":
        opts.packId = takeValue(flag, inline);
        break;
      case "--build-id":
        opts.buildId = takeValue(flag, inline);
        break;
      case "--nonce":
        opts.nonce = takeValue(flag, inline);
        break;
      case "--fixture":
        opts.fixture = takeValue(flag, inline);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Fixture loading + request building (same helpers as tests/import-pack.test.ts)
// ---------------------------------------------------------------------------

function loadFixture(path) {
  const abs = resolve(path);
  let raw;
  try {
    raw = readFileSync(abs, "utf8");
  } catch (err) {
    throw new Error(`Cannot read fixture at ${abs}: ${err.message}`);
  }
  let pack;
  try {
    pack = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Fixture ${abs} is not valid JSON: ${err.message}`);
  }
  return { pack, abs };
}

function buildRequest(pack, opts) {
  return {
    packUrl: PACK_URL,
    packSha256: sha256Hex(pack),
    packId: opts.packId ?? pack.packId ?? "fixture-minimal-v1",
    buildId: opts.buildId ?? `fixture-import-${new Date().toISOString()}`,
    issuedAt: new Date().toISOString(),
    nonce: opts.nonce ?? randomUUID(),
    signature: pack.signature ?? "fixture-ed25519-signature-placeholder",
    idempotencyKey: randomUUID(),
  };
}

function planSummary(request) {
  return [
    `fixture       : ${request.fixturePath}`,
    `packUrl       : ${request.packUrl}`,
    `packId        : ${request.packId}`,
    `buildId       : ${request.buildId}`,
    `packSha256    : ${request.packSha256}`,
    `signature     : ${request.signature} (placeholder — Ed25519 verification is Phase 5)`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`error: ${err.message}`);
    console.error(USAGE);
    process.exit(2);
  }

  if (opts.help) {
    console.log(USAGE);
    return;
  }

  const { pack, abs } = loadFixture(opts.fixture ?? DEFAULT_FIXTURE);
  const request = { ...buildRequest(pack, opts), fixturePath: abs };

  // Validate the fixture against the pack schema up front so --dry-run can
  // promise the import would succeed without touching the database.
  const parsed = templatePackSchema.safeParse(pack);
  if (!parsed.success) {
    console.error(`error: fixture fails template-pack schema validation (${abs})`);
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    process.exit(1);
  }
  if (!verifyManifestHash(pack)) {
    console.warn("warning: fixture manifestSha256 does not match its own content (importer does not enforce this yet).");
  }

  console.log("Import plan:");
  console.log(planSummary(request));

  if (opts.dryRun) {
    console.log("\nDry run — nothing written. Pass --yes to import.");
    return;
  }
  if (!opts.yes) {
    console.log("\nNothing written. Pass --yes to import (or --dry-run for a no-write check).");
    return;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    console.error("error: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL is not set.");
    process.exit(1);
  }
  const supabase = createSupabaseServerClient(createClient, supabaseUrl, process.env);

  console.log(`\nImporting into ${supabaseUrl} …`);
  const receipt = await importTemplatePack(supabase, request, {
    fetchPack: async () => pack, // fixture bytes from disk — no network
  });

  console.log(JSON.stringify(receipt, null, 2));
  if (receipt.status === "replayed") {
    console.log("\nAlready imported (idempotent replay) — gallery seed unchanged.");
  } else {
    console.log("\nImported. The Ad Studio gallery should now list this pack.");
  }
}

main().catch((err) => {
  const code = err?.code;
  const detail = err?.detail;
  console.error(`error: ${code ? `[${code}] ` : ""}${err?.message ?? err}`);
  if (detail !== undefined) console.error(`detail: ${JSON.stringify(detail)}`);
  process.exit(1);
});
