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
 * Signature note: Ed25519 verification is LIVE — `importTemplatePack`
 * verifies the signature (import-pack.ts step 8, `verifyPackSignature`) over
 * the canonical pack JSON whenever FRANK_PACK_PUBLIC_KEY (lowercase hex SPKI
 * DER Ed25519 public key) is set. This script seeds through the documented
 * test/local `fetchPack` injection point, which is the ONLY path where the
 * check is skipped when the key is unset. With `--sig-file <pack.json.sig>`
 * the real factory signature travels through the request and is verified
 * against the env key when present. Without `--sig-file` the placeholder
 * signature is used and WILL be rejected if FRANK_PACK_PUBLIC_KEY is set —
 * real factory packs should always be imported with `--sig-file`.
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
const PLACEHOLDER_SIGNATURE = "fixture-ed25519-signature-placeholder";

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
      --sig-file <path> Path to the Frank factory's pack.json.sig sidecar JSON
                        ({algorithm,keyId,publicKey,signature,packSha256,dev}).
                        Its signature field becomes ImportRequest.signature and
                        its packSha256 is used unless --pack-sha256 overrides it.
      --pack-sha256 <hex> Override the pack SHA-256 (default: the sidecar's
                        packSha256, else sha256Hex of the canonical fixture JSON).

Environment (service-role credential of the TARGET project — local or preview):
  NEXT_PUBLIC_SUPABASE_URL  or  SUPABASE_URL
  SUPABASE_SECRET_KEY (preferred)  or  SUPABASE_SERVICE_ROLE_KEY (legacy)

Examples:
  # Local Supabase (start it first: supabase start)
  node --env-file=.env.local --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \\\
    scripts/adstudio/import-fixture-pack.mjs --yes

  # Import a real Frank factory pack with its signature sidecar
  node --env-file=.env.local --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \\\
    scripts/adstudio/import-fixture-pack.mjs --yes --fixture pack.json \\\
      --sig-file pack.json.sig --pack-sha256 <hex>

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
    sigFile: undefined,
    packSha256: undefined,
  };
  // takeValue consumes the NEXT argv element (after the flag). Defined inside
  // the loop so it can advance `i`; the old argv.shift() popped from the FRONT
  // of the array, which mis-parsed any flag appearing after another flag.
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq >= 0 ? arg.slice(0, eq) : arg;
    const inline = eq >= 0 ? arg.slice(eq + 1) : undefined;
    const takeValue = (f, v) => {
      if (v !== undefined) return v;
      const next = argv[i + 1];
      if (next === undefined) throw new Error(`Missing value for ${f}`);
      i += 1;
      return next;
    };
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
      case "--sig-file":
        opts.sigFile = takeValue(flag, inline);
        break;
      case "--pack-sha256":
        opts.packSha256 = takeValue(flag, inline).toLowerCase();
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

/**
 * Load the Frank factory's signature sidecar (pack.json.sig) — the JSON the
 * factory writes next to every pack: {algorithm, keyId, publicKey, signature,
 * packSha256, dev}. The signature is Ed25519 over the canonical pack JSON and
 * is verified live by import-pack.ts when FRANK_PACK_PUBLIC_KEY is set.
 */
function loadSidecar(path) {
  const abs = resolve(path);
  let raw;
  try {
    raw = readFileSync(abs, "utf8");
  } catch (err) {
    throw new Error(`Cannot read signature sidecar at ${abs}: ${err.message}`);
  }
  let sidecar;
  try {
    sidecar = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Signature sidecar ${abs} is not valid JSON: ${err.message}`);
  }
  if (typeof sidecar.signature !== "string" || sidecar.signature.length === 0) {
    throw new Error(`Signature sidecar ${abs} has no signature field (expected the factory's pack.json.sig)`);
  }
  if (sidecar.algorithm && sidecar.algorithm !== "ed25519") {
    throw new Error(`Signature sidecar ${abs} uses algorithm "${sidecar.algorithm}" — only ed25519 is supported`);
  }
  return { ...sidecar, abs };
}

/**
 * Build the ImportRequest. Signature precedence: explicit --sig-file sidecar
 * > the pack's own signature field > the placeholder (with a loud warning in
 * main). packSha256 precedence: --pack-sha256 > sidecar packSha256 > sha256
 * of the canonical fixture JSON.
 */
function buildRequest(pack, opts, sidecar) {
  const packSha256 = opts.packSha256 ?? sidecar?.packSha256 ?? sha256Hex(pack);
  const signature = sidecar?.signature ?? pack.signature ?? PLACEHOLDER_SIGNATURE;
  // Detect the placeholder by VALUE — the fixture pack itself carries the
  // placeholder string in its signature field.
  const signatureSource =
    signature === PLACEHOLDER_SIGNATURE
      ? "placeholder"
      : sidecar
        ? `sidecar ${sidecar.abs}`
        : "pack.signature";
  return {
    packUrl: PACK_URL,
    packSha256,
    packId: opts.packId ?? pack.packId ?? "fixture-minimal-v1",
    buildId: opts.buildId ?? `fixture-import-${new Date().toISOString()}`,
    issuedAt: new Date().toISOString(),
    nonce: opts.nonce ?? randomUUID(),
    signature,
    idempotencyKey: randomUUID(),
    signatureSource,
  };
}

function planSummary(request) {
  const signatureNote =
    request.signatureSource === "placeholder"
      ? "PLACEHOLDER — verification is LIVE in import-pack.ts, so if FRANK_PACK_PUBLIC_KEY is set this import is REJECTED; use --sig-file"
      : `real Ed25519 — verified live against FRANK_PACK_PUBLIC_KEY when set (from ${request.signatureSource})`;
  return [
    `fixture       : ${request.fixturePath}`,
    `packUrl       : ${request.packUrl}`,
    `packId        : ${request.packId}`,
    `buildId       : ${request.buildId}`,
    `packSha256    : ${request.packSha256}`,
    `signature     : ${request.signature} (${signatureNote})`,
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
  const sidecar = opts.sigFile ? loadSidecar(opts.sigFile) : undefined;
  const request = { ...buildRequest(pack, opts, sidecar), fixturePath: abs };

  if (request.signatureSource === "placeholder") {
    console.warn(
      "warning: using the PLACEHOLDER signature — Ed25519 verification is LIVE in import-pack.ts,\n" +
        "         so if FRANK_PACK_PUBLIC_KEY is set this import will be REJECTED (signature_rejected).\n" +
        "         Import a real factory pack with --sig-file <pack.json.sig> (see scripts/adstudio/README.md).",
    );
  }
  if (opts.packSha256 && opts.packSha256 !== sha256Hex(pack)) {
    console.warn(
      `warning: --pack-sha256 ${opts.packSha256} does not match the canonical-JSON hash of the fixture\n` +
        `         (${sha256Hex(pack)}) — the importer will likely reject it with hash_mismatch.`,
    );
  }

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
