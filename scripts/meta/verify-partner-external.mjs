#!/usr/bin/env node
/**
 * Step 0 go/no-go proof runner for the Meta partner-assisted connection flow.
 *
 * Proves that a genuinely external business can share an ad account + Page
 * with Blockwise's Business Portfolio and that one Blockwise system-user token
 * can run the full disposable product path against them.
 *
 * Security posture:
 * - The system-user token is read from STDIN only (never argv, env, or file).
 * - The token is never printed, logged, or embedded; every Graph call uses an
 *   `Authorization: Bearer` header and no `access_token` query parameter
 *   (repository adapters are wrapped to enforce this, paging URLs included).
 * - Refuses to run against Blockwise-owned ad accounts.
 *
 * The live run is human-gated: a proof_executor runs this script and an
 * independent proof_reviewer reviews the emitted receipt. See
 * docs/runbooks/meta-partner-external-proof.md.
 *
 * Usage: node scripts/meta/verify-partner-external.mjs --help
 */

import { runProof } from "../../src/lib/providers/meta-partner-proof.ts";

const USAGE = `verify-partner-external — Meta partner external proof (Step 0 go/no-go gate)

Usage:
  node scripts/meta/verify-partner-external.mjs [flags]

The Blockwise system-user token is read from STDIN only. Paste it and press
Ctrl+D (EOF). It is never accepted via argv, env, or a file, and it is never
printed or logged.

Required flags (live runs):
  --external-business-id <digits>   Attested external Business Portfolio ID.
  --ad-account-id act_<digits>      The external ad account shared with Blockwise.
  --page-id <digits>                The external Page shared with Blockwise.
  --access-tier <tier>              Marketing API Access Tier in force (recorded).
  --app-mode <mode>                 Meta app mode in force, e.g. development|live.
  --permissions <csv>               Permissions granted to the system user.
  --proof-executor <name>           Person running the proof (recorded).
  --proof-reviewer <name>           Independent reviewer; must differ from executor.

Optional flags:
  --full-path                       Also run the disposable product path
                                    (create PAUSED campaign/adset/creative/ad/form,
                                    read back, submit+retrieve a synthetic test
                                    lead, read reporting, then delete everything).
  --dry-run                         Replay the committed fixture set offline
                                    (no network, no token prompt). CI-safe.
  --output-dir <dir>                Receipt + fixture output directory
                                    (default: docs/evidence/meta-partner-proof/<UTC date>).
  --fixtures-file <path>            Dry-run fixture file
                                    (default: scripts/meta/fixtures/proof-dry-run.json).
  --destination-url <https-url>     Disposable destination URL for the full path.
  --privacy-policy-url <https-url>  Privacy policy URL for the Instant Form.
  --lead-wait-seconds <n>           How long to poll for the synthetic test lead (default 300).
  --graph-version <v>               Override the Graph version (default: repo default).
  -h | --help                       Print this usage and exit.

Environment read (never the token):
  META_BUSINESS_ID    Blockwise's own Business Portfolio ID; required for the
                      external-business enforcement on live runs.
  META_APP_ID         Recorded in the receipt.
  META_APP_ID + META_APP_SECRET  Enable the /debug_token identity probe.

Exit codes: 0 = proof passed; 1 = proof failed; 2 = cleanup incomplete
(some created Meta object could not be deleted/archived).
`;

function parseArgs(argv) {
  const args = {};
  const aliases = {
    "--external-business-id": "externalBusinessId",
    "--ad-account-id": "adAccountId",
    "--page-id": "pageId",
    "--access-tier": "accessTier",
    "--app-mode": "appMode",
    "--permissions": "permissions",
    "--proof-executor": "proofExecutor",
    "--proof-reviewer": "proofReviewer",
    "--output-dir": "outputDir",
    "--fixtures-file": "fixturesFile",
    "--destination-url": "destinationUrl",
    "--privacy-policy-url": "privacyPolicyUrl",
    "--lead-wait-seconds": "leadWaitSeconds",
    "--graph-version": "graphVersion",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      args.help = true;
      continue;
    }
    if (arg === "--full-path") {
      args.fullPath = true;
      continue;
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    // Hard refusal: the token must never travel via argv.
    if (/^--(token|access-token|system-token|app-token)/i.test(arg)) {
      throw new Error(`${arg} is refused: the system-user token is read from STDIN only.`);
    }
    const key = aliases[arg];
    if (!key) {
      throw new Error(`Unknown flag: ${arg} (see --help)`);
    }
    const value = argv[i + 1];
    if (value === undefined) {
      throw new Error(`Flag ${arg} requires a value (see --help)`);
    }
    i += 1;
    args[key] = value;
  }
  return args;
}

function readTokenFromStdin() {
  process.stderr.write(
    "Paste the Blockwise system-user token, then press Ctrl+D (EOF). It is not echoed or logged: ",
  );
  return new Promise((resolveToken) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolveToken(data.trim()));
  });
}

function utcDateStamp(date) {
  return date.toISOString().slice(0, 10);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exit(1);
  }

  if (args.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const dryRun = args.dryRun === true;
  const accessToken = dryRun ? "dry-run-token-not-a-real-credential" : await readTokenFromStdin();

  if (!dryRun) {
    if (!accessToken) {
      process.stderr.write("Refusing to run: the system-user token on STDIN is empty.\n");
      process.exit(1);
    }
    if (accessToken.startsWith("PLACEHOLDER")) {
      process.stderr.write("Refusing to run: PLACEHOLDER tokens are not accepted.\n");
      process.exit(1);
    }
  }

  const result = await runProof({
    dryRun,
    fullPath: args.fullPath === true,
    accessToken,
    externalBusinessId: args.externalBusinessId ?? "",
    adAccountId: args.adAccountId ?? "",
    pageId: args.pageId ?? "",
    blockwiseBusinessId: process.env.META_BUSINESS_ID ?? null,
    appToken: process.env.META_APP_ID && process.env.META_APP_SECRET
      ? `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`
      : null,
    appId: process.env.META_APP_ID ?? "",
    graphVersion: args.graphVersion,
    accessTier: args.accessTier ?? "",
    appMode: args.appMode ?? "",
    permissions: args.permissions
      ? args.permissions.split(",").map((value) => value.trim()).filter(Boolean)
      : [],
    proofExecutor: args.proofExecutor ?? "",
    proofReviewer: args.proofReviewer ?? "",
    outputDir: args.outputDir ?? `docs/evidence/meta-partner-proof/${utcDateStamp(new Date())}`,
    destinationUrl: args.destinationUrl ?? "https://example.com/proof-destination",
    privacyPolicyUrl: args.privacyPolicyUrl ?? "https://example.com/privacy",
    leadWaitSeconds: args.leadWaitSeconds ? Number(args.leadWaitSeconds) : undefined,
    fixturesFile: args.fixturesFile ?? null,
    cwd: process.cwd(),
  });

  process.stdout.write("\n=== Proof summary ===\n");
  for (const probe of result.probes) {
    process.stdout.write(`${probe.status.padEnd(4)}  ${probe.label}\n`);
  }
  process.stdout.write(`Cleanup receipts: ${result.cleanupReceipts.length} ` +
    `(${result.cleanupReceipts.filter((r) => r.action === "deleted").length} deleted, ` +
    `${result.cleanupReceipts.filter((r) => r.action === "archived").length} archived, ` +
    `${result.cleanupReceipts.filter((r) => r.action === "failed").length} failed)\n`);
  for (const error of result.errors) {
    process.stdout.write(`ERROR: ${error}\n`);
  }
  process.stdout.write(result.ok
    ? "RESULT: GO — proof passed. Commit the receipt for independent review.\n"
    : "RESULT: NO-GO — proof failed. Do not enable partner starts.\n");
  process.exit(result.exitCode);
}

main().catch((error) => {
  process.stderr.write(`Proof run aborted: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
