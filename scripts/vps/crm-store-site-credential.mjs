#!/usr/bin/env node
/**
 * Store a customer site's CRM credential in the product's encrypted vault.
 *
 * `scripts/provision-site.sh` issues the credential and writes it to a 600 file,
 * then stops. The vault write belongs to the product, because the vault key
 * (`TOKEN_ENCRYPTION_KEY`) and the service-role client are the product's, so this
 * command is the second half of provisioning: it reads that file and calls the
 * same `upsertCrmSiteCredential` the product uses.
 *
 * A site whose credential is not in the vault is provisioned but unusable: the
 * Frappe API will answer, and the product will refuse the workspace with
 * `setup_pending`. Running this command is what makes the site live.
 *
 * Usage, on the VPS host:
 *
 *   node --import tsx scripts/vps/crm-store-site-credential.mjs \
 *     --credential-file /srv/blockwise/crm/credentials/demo.crm.internal.json
 *
 * or name the site and let the default directory resolve the file:
 *
 *   node --import tsx scripts/vps/crm-store-site-credential.mjs --site demo.crm.internal
 *
 * Options:
 *   --credential-file <path>  the file provision-site.sh wrote (600)
 *   --site <site>             resolve <credential-dir>/<site>.json instead
 *   --credential-dir <path>   default /srv/blockwise/crm/credentials
 *   --workspace <uuid>        override the workspace id in the file
 *   --env-file <path>         default /srv/blockwise/product/.env
 *   --supabase-url <url>      override the vault's address
 *   --dry-run                 read, validate and report, write nothing
 *   --allow-unbound           store even though the site reports binding problems
 *
 * The secret is never printed. Only the API key's last four characters are, and
 * they match what provisioning reported, so an operator can confirm that the
 * credential in the vault is the one that was just issued.
 *
 * Exit codes: 0 stored and read back, 2 usage or environment, 3 refused
 * (unbound site, unusable file), 4 the vault refused the write.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { loadCrmSiteCredential, upsertCrmSiteCredential } from "../../src/lib/crm/credentials.ts";
import { createSupabaseServiceClient } from "../../src/lib/supabase/service.ts";

const DEFAULT_CREDENTIAL_DIR = process.env.CRM_CREDENTIAL_DIR ?? "/srv/blockwise/crm/credentials";
const DEFAULT_ENV_FILE = process.env.BLOCKWISE_PRODUCT_ENV_FILE ?? "/srv/blockwise/product/.env";

/**
 * Only these leave the product env file. `BLOCKWISE_SUPABASE_SERVER_URL` is
 * deliberately absent: it is an internal docker address that means nothing from
 * the host, and this command decides its own transport below.
 */
const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TOKEN_ENCRYPTION_KEY",
];

function usage(problem) {
  console.error(`error: ${problem}`);
  console.error("usage: node --import tsx scripts/vps/crm-store-site-credential.mjs \\");
  console.error("         (--credential-file <path> | --site <site>) [--dry-run]");
  process.exit(2);
}

function parseArgs(argv) {
  const args = {
    credentialFile: "",
    site: "",
    credentialDir: DEFAULT_CREDENTIAL_DIR,
    workspace: "",
    envFile: DEFAULT_ENV_FILE,
    supabaseUrl: "",
    dryRun: false,
    allowUnbound: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) usage(`${token} needs a value`);
      index += 1;
      return value;
    };
    switch (token) {
      case "--credential-file": args.credentialFile = next(); break;
      case "--site": args.site = next(); break;
      case "--credential-dir": args.credentialDir = next(); break;
      case "--workspace": args.workspace = next(); break;
      case "--env-file": args.envFile = next(); break;
      case "--supabase-url": args.supabaseUrl = next(); break;
      case "--dry-run": args.dryRun = true; break;
      case "--allow-unbound": args.allowUnbound = true; break;
      case "--help":
      case "-h":
        console.log("See the header of this file for usage.");
        process.exit(0);
        break;
      default:
        usage(`unknown argument ${token}`);
    }
  }

  if (!args.credentialFile && !args.site) usage("pass --credential-file or --site");
  if (args.credentialFile && args.site) usage("pass only one of --credential-file and --site");
  if (!args.credentialFile) args.credentialFile = join(args.credentialDir, `${args.site}.json`);
  return args;
}

/** Minimal KEY=VALUE reader. Real env wins; this only fills gaps. */
function readEnvFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }

  const values = {};
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!ENV_KEYS.includes(key)) continue;
    values[key] = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/gu, "");
  }
  return values;
}

function readCredentialFile(path) {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    console.error(`error: no credential file at ${path}`);
    console.error("       run scripts/provision-site.sh first; it writes that file.");
    process.exit(3);
  }

  // A credential any other local user can read is not a credential. provision-site.sh
  // writes 600, so this only fires when a file has been copied by hand.
  if ((stats.mode & 0o077) !== 0) {
    console.error(`error: ${path} is readable beyond its owner (mode ${(stats.mode & 0o777).toString(8)})`);
    console.error(`       fix it with: chmod 600 ${path}`);
    process.exit(3);
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`error: ${path} is not valid JSON: ${error.message}`);
    process.exit(3);
  }
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const file = readCredentialFile(args.credentialFile);
  const apiKey = String(file.api_key ?? "").trim();
  const apiSecret = String(file.api_secret ?? "").trim();
  const workspaceId = String(args.workspace || file.workspace_id || "").trim();
  const site = String(file.site || args.site || "").trim();
  const lastFour = String(file.credential_last_four ?? "").trim();
  const bindingProblems = Array.isArray(file.binding_problems) ? file.binding_problems : [];

  if (!apiKey || !apiSecret) {
    console.error(`error: ${args.credentialFile} has no api_key and api_secret pair`);
    process.exit(3);
  }
  if (!workspaceId) {
    console.error("error: no workspace id. The credential file has none; pass --workspace <uuid>.");
    process.exit(3);
  }

  // An unbound site answers the API and refuses every workspace, so storing its
  // credential would create a site that looks provisioned and is not.
  if (bindingProblems.length > 0 && !args.allowUnbound) {
    console.error(`error: ${site || args.credentialFile} is not bound to a workspace:`);
    for (const problem of bindingProblems) console.error(`       ${problem}`);
    console.error("       fix the binding and re-run, or pass --allow-unbound to store it anyway.");
    process.exit(3);
  }

  const envValues = readEnvFile(args.envFile);
  for (const [key, value] of Object.entries(envValues)) {
    if (!process.env[key]) process.env[key] = value;
  }

  // One decision point for the vault's address. The env file's internal
  // BLOCKWISE_SUPABASE_SERVER_URL is not copied, so a host-run command can never
  // inherit a docker hostname it cannot resolve.
  const supabaseUrl =
    args.supabaseUrl ||
    process.env.BLOCKWISE_CRM_CREDENTIAL_SUPABASE_URL ||
    envValues.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    envValues.SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";
  if (!supabaseUrl) {
    console.error(`error: no Supabase URL. Pass --supabase-url, or set NEXT_PUBLIC_SUPABASE_URL`);
    console.error(`       in ${args.envFile}.`);
    process.exit(2);
  }
  process.env.BLOCKWISE_SUPABASE_SERVER_URL = supabaseUrl;

  if (!process.env.TOKEN_ENCRYPTION_KEY) {
    console.error(`error: TOKEN_ENCRYPTION_KEY is not set and ${args.envFile} does not define it.`);
    console.error("       The vault cannot be opened without it.");
    process.exit(2);
  }

  console.log(`==> site      ${site || "(unnamed)"}`);
  console.log(`==> workspace ${workspaceId}`);
  console.log(`==> vault     ${supabaseUrl}`);
  console.log(`==> key       ...${lastFour || apiKey.slice(-4)}  (secret not printed)`);
  if (args.dryRun) {
    console.log("dry run: validated; nothing was written.");
    return 0;
  }

  return store({ supabaseUrl, workspaceId, apiKey, apiSecret, lastFour, site });
}

async function store({ supabaseUrl, workspaceId, apiKey, apiSecret, lastFour, site }) {
  let supabase;
  try {
    supabase = createSupabaseServiceClient({ env: { ...process.env, BLOCKWISE_SUPABASE_SERVER_URL: supabaseUrl } });
  } catch (error) {
    console.error(`error: could not build the service client: ${error.message}`);
    return 2;
  }

  let written;
  try {
    written = await upsertCrmSiteCredential({
      serviceSupabase: supabase,
      workspaceId,
      apiKey,
      apiSecret,
      lastFour,
    });
  } catch (error) {
    console.error(`error: the vault refused the write: ${error.message}`);
    return 4;
  }

  // Read it back. A write that cannot be read is not a stored credential, and
  // this is exactly the failure that would otherwise surface later as
  // `setup_pending` with no explanation.
  let readBack;
  try {
    readBack = await loadCrmSiteCredential(supabase, workspaceId);
  } catch (error) {
    console.error(`error: the credential was written but cannot be read back: ${error.message}`);
    return 4;
  }

  if (!readBack || readBack.apiKey !== apiKey || readBack.apiSecret !== apiSecret) {
    console.error("error: the stored credential does not match what was written");
    return 4;
  }

  console.log(`stored  ${site || workspaceId} -> ...${written.lastFour} (read back and verified)`);
  console.log("The site is now usable. Run scripts/verify_crm.py to prove the API answers for it.");
  return 0;
}

process.exit(await main());
