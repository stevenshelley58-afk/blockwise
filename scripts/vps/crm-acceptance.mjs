#!/usr/bin/env node
/**
 * A01-A43: the release acceptance matrix for the native-backed customer CRM.
 *
 * The handover names this matrix as a release gate but never defines it, so
 * this file is the definition. It runs on the VPS host against the REAL stack:
 * the real product database, the real vault, the real Frappe site and the real
 * adapter. Nothing is stubbed, and there is no unconditional pass - every check
 * asserts something it just observed.
 *
 * It is deliberately not part of `npm test`. It needs a running product, a
 * running CRM and Docker, so it is a deployment step rather than a unit test.
 *
 * Run it through the wrapper, which assembles the environment:
 *
 *   bash scripts/vps/crm-acceptance.sh
 *
 * Environment (set by the wrapper):
 *   PRODUCT_SUPABASE_URL, PRODUCT_SERVICE_ROLE_KEY, TOKEN_ENCRYPTION_KEY
 *   CRM_BASE_URL            the CRM backend on the shared docker network
 *   ACCEPTANCE_SITE         the Frappe site to test against
 *   ACCEPTANCE_WORKSPACE    the workspace bound to that site
 *   ACCEPTANCE_CLEANUP=1    delete the probe leads this run created
 *
 * The checks that write use an `acc-<timestamp>` prefix, so a later run can
 * tell its own residue apart from an earlier one's.
 */

import { execFileSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import { loadCrmSiteCredential } from "../../src/lib/crm/credentials.ts";
import { createWorkspaceCrm } from "../../src/lib/crm/index.ts";

// --- configuration -----------------------------------------------------------

const PRODUCT_DB = process.env.PRODUCT_DB ?? "blockwise-product-product-db-1";
const CRM_DB = process.env.CRM_DB ?? "blockwise-crm-db-1";
const CRM_BACKEND = process.env.CRM_BACKEND ?? "blockwise-crm-backend-1";
const PRODUCT_ROOT = process.env.PRODUCT_ROOT ?? "/worktrees/customer-crm-build";
const FRAPPE_ROOT = process.env.FRAPPE_ROOT ?? "/worktrees/customer-crm-frappe";
const CRM_DEPLOY_ENV = process.env.CRM_DEPLOY_ENV ?? "/srv/blockwise/crm/deploy/.env";
const PRODUCT_ENV = process.env.PRODUCT_ENV ?? "/srv/blockwise/product/.env";
const CREDENTIAL_FILE = process.env.CREDENTIAL_FILE ?? "/srv/blockwise/crm/credentials/demo.crm.internal.json";

const SITE = process.env.ACCEPTANCE_SITE ?? "demo.crm.internal";
const WORKSPACE = process.env.ACCEPTANCE_WORKSPACE ?? "11111111-1111-4111-8111-111111111111";
const BASE_URL = process.env.CRM_BASE_URL;
const SUPABASE_URL = process.env.PRODUCT_SUPABASE_URL;
const SERVICE_KEY = process.env.PRODUCT_SERVICE_ROLE_KEY;
const STAMP = `acc-${Date.now()}`;

for (const [name, value] of Object.entries({
  CRM_BASE_URL: BASE_URL,
  PRODUCT_SUPABASE_URL: SUPABASE_URL,
  PRODUCT_SERVICE_ROLE_KEY: SERVICE_KEY,
})) {
  if (!value) {
    console.error(`${name} is required; run this through scripts/vps/crm-acceptance.sh`);
    process.exit(2);
  }
}

// --- reporting ---------------------------------------------------------------

const rows = [];
let currentGroup = "";

function group(title) {
  currentGroup = title;
  console.log(`\n${title}`);
}

function check(id, description, ok, detail = "") {
  const detailText = String(detail).replace(/\n/g, "\n              ");
  rows.push({ id, group: currentGroup, description, ok: Boolean(ok), detail: String(detail) });
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}${detailText ? `\n              ${detailText}` : ""}`,
  );
}

/** A check that is allowed to throw: a thrown error is a failure, not a crash. */
async function attempt(id, description, fn) {
  try {
    const { ok, detail } = await fn();
    check(id, description, ok, detail);
  } catch (error) {
    check(id, description, false, `threw: ${error?.message ?? error}`);
  }
}

// --- transports --------------------------------------------------------------

function psql(query) {
  return execFileSync(
    "docker",
    ["exec", PRODUCT_DB, "psql", "-U", "postgres", "-d", "blockwise", "-tAc", query],
    { encoding: "utf8" },
  ).trim();
}

let cachedDbName = null;
let cachedPassword = null;
let cachedClient = null;

/** The site's database name comes from that site's own config, never a guess. */
function crmSiteDb() {
  if (!cachedDbName) {
    cachedDbName = execFileSync(
      "docker",
      [
        "exec",
        CRM_BACKEND,
        "python3",
        "-c",
        `import json;print(json.load(open('/home/frappe/frappe-bench/sites/${SITE}/site_config.json'))['db_name'])`,
      ],
      { encoding: "utf8" },
    ).trim();
  }
  return cachedDbName;
}

function crmPassword() {
  if (!cachedPassword) {
    cachedPassword = execFileSync(
      "docker",
      ["exec", CRM_DB, "sh", "-c", 'printf %s "${MYSQL_ROOT_PASSWORD:-$MARIADB_ROOT_PASSWORD}"'],
      { encoding: "utf8" },
    ).trim();
  }
  return cachedPassword;
}

/** `mariadb:11` ships the client as `mariadb`; older images ship `mysql`. */
function crmClient() {
  if (!cachedClient) {
    try {
      execFileSync("docker", ["exec", CRM_DB, "sh", "-c", "command -v mariadb"], { stdio: "pipe" });
      cachedClient = "mariadb";
    } catch {
      cachedClient = "mysql";
    }
  }
  return cachedClient;
}

function csql(query) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "-e",
      `MYSQL_PWD=${crmPassword()}`,
      CRM_DB,
      crmClient(),
      "-uroot",
      "-N",
      "-B",
      crmSiteDb(),
      "-e",
      query,
    ],
    { encoding: "utf8" },
  ).trim();
}

function shell(command) {
  return execFileSync("sh", ["-c", command], { encoding: "utf8" }).trim();
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function sql(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function envValue(file, key) {
  return shell(`sed -n 's/^${key}=//p' ${file} | head -1`);
}

// --- start -------------------------------------------------------------------

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log("A01-A43  native-backed customer CRM acceptance matrix");
console.log(`         site       ${SITE}`);
console.log(`         workspace  ${WORKSPACE}`);
console.log(`         crm        ${BASE_URL}`);
console.log(`         product    ${SUPABASE_URL}`);
console.log(`         stamp      ${STAMP}`);

const credential = await loadCrmSiteCredential(supabase, WORKSPACE);
if (!credential) {
  console.error(`\n${WORKSPACE} has no stored CRM credential. Store one first; nothing below would be meaningful.`);
  process.exit(2);
}

const { mapping, commands } = await createWorkspaceCrm({
  supabase,
  workspaceId: WORKSPACE,
  env: { ...process.env, CRM_BASE_URL: BASE_URL },
});

async function api(method, body, headers = {}) {
  const response = await fetch(`${BASE_URL}/api/method/blockwise_crm.api.${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Frappe-Site-Name": SITE,
      Authorization: `token ${credential.apiKey}:${credential.apiSecret}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

const OTHER_SITE = SITE === "demo.crm.internal" ? "my-workspace.crm.internal" : "demo.crm.internal";

// =============================================================================
// A. Release identity  (A01-A06)
// =============================================================================

group("A. Release identity");

await attempt("A01", "the product app answers on the public host", async () => {
  const response = await fetch("https://blockwise.sale/api/health");
  const body = await response.json().catch(() => ({}));
  return {
    ok: response.ok && typeof body.revision === "string",
    detail: `status=${response.status} revision=${body.revision}`,
  };
});

await attempt("A02", "the deployed product revision is origin/main", async () => {
  const body = await (await fetch("https://blockwise.sale/api/health")).json().catch(() => ({}));
  const expected = git(PRODUCT_ROOT, ["rev-parse", "origin/main"]);
  return { ok: body.revision === expected, detail: `deployed=${body.revision} origin/main=${expected}` };
});

await attempt("A03", "every live CRM container runs the tag the deploy env names", async () => {
  const tag = envValue(CRM_DEPLOY_ENV, "CRM_TAG");
  const running = shell("docker ps --format '{{.Names}} {{.Image}}'")
    .split("\n")
    .filter((line) => line.startsWith("blockwise-crm-") && line.includes("blockwise-crm-app:"));
  const wrong = running.filter((line) => !line.endsWith(`blockwise-crm-app:${tag}`));
  return {
    ok: running.length > 0 && wrong.length === 0,
    detail: `tag=${tag} containers=${running.length}${wrong.length ? ` wrong: ${wrong.join(", ")}` : ""}`,
  };
});

await attempt("A04", "the running CRM image is built from the intended commit", async () => {
  const tag = envValue(CRM_DEPLOY_ENV, "CRM_TAG");
  const baked = shell(
    `docker image inspect blockwise-crm-app:${tag} --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'`,
  );
  const intended = git(FRAPPE_ROOT, ["rev-parse", "HEAD"]);
  return { ok: baked === intended, detail: `image=${baked} worktree=${intended}` };
});

await attempt("A05", "the product ledger records the CRM site credential migration", async () => {
  const count = psql("select count(*) from public.blockwise_product_migration_ledger where version like '%crm_site_credentials%'");
  return { ok: Number(count) === 1, detail: `ledger rows matching crm_site_credentials = ${count}` };
});

await attempt("A06", "the migration allowlist is strictly chronological", async () => {
  const list = shell(`cat ${PRODUCT_ROOT}/infra/product/product-migrations.txt`)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const sorted = [...list].sort();
  const firstOutOfOrder = list.find((name, index) => name !== sorted[index]);
  return {
    ok: list.length > 0 && !firstOutOfOrder,
    detail: `${list.length} entries${firstOutOfOrder ? `, first out of order: ${firstOutOfOrder}` : ""}`,
  };
});

// =============================================================================
// B. The per-site credential lane  (A07-A12)
// =============================================================================

group("B. The per-site credential lane");

await attempt("A07", "the vault holds a CRM-lane credential for this workspace", async () => {
  const count = psql(
    `select count(*) from private.provider_token_vault where runtime_provider = 'blockwise_crm_site' and workspace_id = ${sql(WORKSPACE)}`,
  );
  return { ok: Number(count) === 1, detail: `rows=${count}` };
});

await attempt("A08", "no CRM-lane row is service-scoped", async () => {
  const nulls = psql("select count(*) from private.provider_token_vault where runtime_provider = 'blockwise_crm_site' and workspace_id is null");
  const total = psql("select count(*) from private.provider_token_vault where runtime_provider = 'blockwise_crm_site'");
  return { ok: Number(nulls) === 0 && Number(total) >= 1, detail: `total=${total} service-scoped=${nulls}` };
});

await attempt("A09", "the service lane keeps a unique index of its own", async () => {
  // Asserted by predicate, not by name: the migration narrows the original
  // service-wide index rather than adding a second one, and a rename would
  // otherwise read as a failure here while the guarantee still held.
  const predicate = psql(
    "select indexdef from pg_indexes where schemaname='private' and tablename='provider_token_vault' and indexdef ilike '%UNIQUE%' and indexdef ilike '%workspace_id IS NULL%'",
  );
  return { ok: /UNIQUE/i.test(predicate), detail: predicate || "(no service-lane unique index found)" };
});

await attempt("A10", "the CRM lane carries a unique index scoped to the CRM lane", async () => {
  const predicate = psql(
    "select indexdef from pg_indexes where schemaname='private' and tablename='provider_token_vault' and indexdef ilike '%UNIQUE%' and indexdef ilike '%blockwise_crm_site%'",
  );
  const scoped = /workspace_id/i.test(predicate) && !/workspace_id IS NULL/i.test(predicate);
  return { ok: /UNIQUE/i.test(predicate) && scoped, detail: predicate || "(index not found)" };
});

await attempt("A11", "the mapping row records the stored credential, and it matches the adapter's", async () => {
  const row = psql(
    `select credential_version || '|' || coalesce(credential_last_four,'-') from public.crm_workspace_sites where workspace_id = ${sql(WORKSPACE)}`,
  );
  const [version, lastFour] = row.split("|");
  const tail = String(credential.apiKey).slice(-4);
  return {
    ok: Number(version) >= 1 && lastFour === tail,
    detail: `version=${version} mapping_last_four=${lastFour} adapter_last_four=${tail}`,
  };
});

await attempt("A12", "a second workspace can hold its own CRM credential", async () => {
  // The defect the rehearsal found: a service-wide unique index admitted one
  // customer site in total. This asserts the CRM-lane index is workspace-scoped
  // and that more than one workspace-scoped row can exist, without inventing a
  // second real credential, which would be a provisioning act, not a check.
  const predicate = psql(
    "select indexdef from pg_indexes where schemaname='private' and tablename='provider_token_vault' and indexdef ilike '%UNIQUE%' and indexdef ilike '%blockwise_crm_site%'",
  );
  const workspaceScoped = /workspace_id/i.test(predicate) && !/workspace_id IS NULL/i.test(predicate);
  const distinct = psql("select count(distinct workspace_id) from private.provider_token_vault where runtime_provider = 'blockwise_crm_site'");
  return {
    ok: workspaceScoped && Number(distinct) >= 1,
    detail: `CRM-lane index is workspace-scoped=${workspaceScoped}; workspaces holding a CRM credential=${distinct}`,
  };
});

// =============================================================================
// C. Identity, binding and routing  (A13-A17)
// =============================================================================

group("C. Identity, binding and routing");

await attempt("A13", "a call with no credential is refused", async () => {
  const response = await fetch(`${BASE_URL}/api/method/blockwise_crm.api.get_lead`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Frappe-Site-Name": SITE },
    body: JSON.stringify({ workspace_id: WORKSPACE, lead: "CRM-LEAD-0001" }),
  });
  return { ok: response.status >= 400, detail: `status=${response.status}` };
});

await attempt("A14", "a call with a wrong secret is refused", async () => {
  const response = await fetch(`${BASE_URL}/api/method/blockwise_crm.api.get_lead`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Frappe-Site-Name": SITE,
      Authorization: `token ${credential.apiKey}:not-the-secret`,
    },
    body: JSON.stringify({ workspace_id: WORKSPACE, lead: "CRM-LEAD-0001" }),
  });
  return { ok: response.status >= 400, detail: `status=${response.status}` };
});

await attempt("A15", "a valid credential is accepted", async () => {
  const { status, text } = await api("health", { workspace_id: WORKSPACE });
  return { ok: status === 200 && /"ok"/.test(text), detail: `status=${status} ${text.slice(0, 90)}` };
});

await attempt("A16", "the API answers for the mapped site, not a default", async () => {
  const health = await commands.health();
  return { ok: health.site === mapping.crmSite, detail: `reported=${health.site} mapped=${mapping.crmSite}` };
});

await attempt("A17", "a request routed at another site, and an unbound workspace, are both refused", async () => {
  const wrongSite = await fetch(`${BASE_URL}/api/method/blockwise_crm.api.health`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Frappe-Site-Name": OTHER_SITE,
      Authorization: `token ${credential.apiKey}:${credential.apiSecret}`,
    },
    body: JSON.stringify({ workspace_id: WORKSPACE }),
  });
  const unbound = await api("get_lead", {
    workspace_id: "00000000-0000-4000-8000-000000000000",
    lead: "CRM-LEAD-0001",
  });
  return {
    ok: wrongSite.status >= 400 && unbound.status >= 400,
    detail: `site=${OTHER_SITE} status=${wrongSite.status}; unbound workspace status=${unbound.status}`,
  };
});

// =============================================================================
// D. Revision guards  (A18-A22)
// =============================================================================

group("D. Revision guards");

let probeLead = null;

await attempt("A18", "capture creates an enquiry that starts at New", async () => {
  const first = await commands.captureEnquiry({
    commandId: `${STAMP}-capture`,
    sourceProvider: "meta",
    sourceSubmissionId: `${STAMP}-sub`,
    firstName: "Acceptance",
    lastName: "Probe",
    email: `${STAMP}@example.test`,
    propertyContext: "Acceptance probe",
  });
  probeLead = first.lead;
  return { ok: first.created === true && first.stage === "New", detail: `lead=${probeLead} stage=${first.stage}` };
});

await attempt("A19", "a mutation without expected_revision is refused", async () => {
  const { status, text } = await api("log_contact", {
    workspace_id: WORKSPACE,
    command_id: `${STAMP}-norev`,
    lead: probeLead,
  });
  return { ok: status >= 400, detail: `status=${status} ${text.slice(0, 90)}` };
});

await attempt("A20", "expected_revision 0 is accepted as present, not treated as missing", async () => {
  // The first write to a brand-new enquiry legitimately sends 0. A truthiness
  // check refused it and broke every first write, so the case is pinned here.
  const { status, text } = await api("log_contact", {
    workspace_id: WORKSPACE,
    command_id: `${STAMP}-rev0`,
    lead: probeLead,
    expected_revision: 0,
  });
  return { ok: status === 200, detail: `status=${status} ${text.slice(0, 80)}` };
});

await attempt("A21", "a stale expected_revision is refused and writes nothing", async () => {
  const before = await commands.getLead(probeLead);
  const stale = Math.max(0, before.revision - 1);
  const { status } = await api("log_contact", {
    workspace_id: WORKSPACE,
    command_id: `${STAMP}-stale`,
    lead: probeLead,
    expected_revision: stale,
  });
  const after = await commands.getLead(probeLead);
  return {
    ok: status >= 400 && after.revision === before.revision,
    detail: `sent=${stale} actual=${before.revision} after=${after.revision} status=${status}`,
  };
});

await attempt("A22", "four simultaneous writers produce exactly one winner", async () => {
  const before = await commands.getLead(probeLead);
  const attempts = await Promise.allSettled(
    [0, 1, 2, 3].map((n) =>
      commands.logReply({
        commandId: `${STAMP}-race-${n}`,
        lead: probeLead,
        expectedRevision: before.revision,
        note: `race ${n}`,
      }),
    ),
  );
  const winners = attempts.filter((entry) => entry.status === "fulfilled").length;
  const after = await commands.getLead(probeLead);
  return {
    ok: winners === 1 && after.revision === before.revision + 1,
    detail: `winners=${winners} revision ${before.revision} -> ${after.revision}`,
  };
});

// =============================================================================
// E. Enquiry identity and receipts  (A23-A28)
// =============================================================================

group("E. Enquiry identity and receipts");

await attempt("A23", "the database enforces enquiry identity natively", async () => {
  const count = csql(
    "select count(*) from information_schema.statistics where table_schema = database() and table_name = 'tabCRM Lead' and column_name = 'blockwise_source_key' and non_unique = 0",
  );
  return { ok: Number(count) >= 1, detail: `unique indexes covering blockwise_source_key = ${count}` };
});

await attempt("A24", "a repeated command_id returns the stored result, not a second write", async () => {
  const again = await commands.captureEnquiry({
    commandId: `${STAMP}-capture`,
    sourceProvider: "meta",
    sourceSubmissionId: `${STAMP}-sub`,
    firstName: "Acceptance",
    lastName: "Probe",
  });
  const count = csql(`select count(*) from \`tabCRM Lead\` where blockwise_source_key like ${sql(`${STAMP}%`)}`);
  return {
    ok: again.lead === probeLead && Number(count) === 1,
    detail: `lead=${again.lead} matching leads=${count}`,
  };
});

await attempt("A25", "a new command_id for the same submission does not duplicate", async () => {
  const second = await commands.captureEnquiry({
    commandId: `${STAMP}-capture-b`,
    sourceProvider: "meta",
    sourceSubmissionId: `${STAMP}-sub`,
  });
  return { ok: second.created === false && second.lead === probeLead, detail: `created=${second.created} lead=${second.lead}` };
});

await attempt("A26", "reusing a command_id with different content is refused", async () => {
  const { status, text } = await api("capture_enquiry", {
    workspace_id: WORKSPACE,
    command_id: `${STAMP}-capture`,
    source_provider: "meta",
    source_submission_id: `${STAMP}-different`,
  });
  return { ok: status >= 400, detail: `status=${status} ${text.slice(0, 90)}` };
});

await attempt("A27", "the delivery table refuses a duplicate source submission", async () => {
  const predicate = psql(
    "select indexdef from pg_indexes where schemaname='public' and indexname='lead_crm_delivery_jobs_workspace_id_source_provider_source__key'",
  );
  return { ok: /UNIQUE/i.test(predicate) && /workspace_id, source_provider, source_submission_id/i.test(predicate), detail: predicate || "(index not found)" };
});

await attempt("A28", "the delivery table refuses a duplicate command id", async () => {
  const predicate = psql(
    "select indexdef from pg_indexes where schemaname='public' and indexname='lead_crm_delivery_jobs_workspace_id_command_id_key'",
  );
  return { ok: /UNIQUE/i.test(predicate) && /workspace_id, command_id/i.test(predicate), detail: predicate || "(index not found)" };
});

// =============================================================================
// F. Capture and delivery  (A29-A33)
// =============================================================================

group("F. Capture and delivery");

// The delivery path had never run against a real row: `public.leads` was empty
// in every workspace, so a check that merely read the delivery table passed
// without proving anything. This group inserts one probe lead, drives the real
// worker over it, and removes it again, so the path is exercised end to end.
let probeLeadId = null;
let probeJobId = null;

await attempt("A29", "CRM delivery is off unless it is switched on explicitly", async () => {
  const { crmDeliveryEnabled } = await import("../../src/lib/crm/delivery.ts");
  const fromEnvFile = envValue(PRODUCT_ENV, "BLOCKWISE_ENABLE_CRM_DELIVERY") || "(unset)";
  return {
    ok:
      crmDeliveryEnabled({}) === false &&
      crmDeliveryEnabled({ BLOCKWISE_ENABLE_CRM_DELIVERY: "true" }) === true &&
      crmDeliveryEnabled({ BLOCKWISE_ENABLE_CRM_DELIVERY: "false" }) === false,
    detail: `product env value=${fromEnvFile}; default=${crmDeliveryEnabled({})}`,
  };
});

await attempt("A30", "a captured lead produces exactly one delivery job, and stays pending", async () => {
  const { ensureLeadCrmDeliveryJob } = await import("../../src/lib/crm/delivery.ts");

  // Wrapped in a CTE so psql prints the id alone: a bare INSERT also prints its
  // command tag, which would land in the captured value.
  probeLeadId = psql(
    `with ins as (insert into public.leads (workspace_id, provider, external_id, email, full_name, suburb) values (${sql(WORKSPACE)}, 'meta', ${sql(`${STAMP}-lead`)}, ${sql(`${STAMP}@example.test`)}, 'Acceptance Probe', 'Acceptance Suburb') returning id) select id from ins`,
  );

  const first = await ensureLeadCrmDeliveryJob({
    serviceSupabase: supabase,
    workspaceId: WORKSPACE,
    leadId: probeLeadId,
    sourceProvider: "meta",
    sourceSubmissionId: STAMP,
  });
  const again = await ensureLeadCrmDeliveryJob({
    serviceSupabase: supabase,
    workspaceId: WORKSPACE,
    leadId: probeLeadId,
    sourceProvider: "meta",
    sourceSubmissionId: STAMP,
  });
  probeJobId = first.id;

  const rows = psql(`select count(*) from public.lead_crm_delivery_jobs where lead_id = ${sql(probeLeadId)}`);
  return {
    ok: first.id === again.id && Number(rows) === 1 && first.state === "pending",
    detail: `job=${first.id} re-ensure=${again.id} rows=${rows} state=${first.state}`,
  };
});

await attempt("A31", "the job reaches the CRM and records the lead it created", async () => {
  if (!probeJobId) return { ok: false, detail: "A30 produced no delivery job, so there is nothing to deliver" };

  const { executeLeadCrmDeliveryJobById } = await import("../../src/lib/crm/delivery-worker.ts");
  const { loadLeadCrmDeliveryJob } = await import("../../src/lib/crm/delivery.ts");

  const previous = process.env.BLOCKWISE_ENABLE_CRM_DELIVERY;
  process.env.BLOCKWISE_ENABLE_CRM_DELIVERY = "true";
  let outcome;
  try {
    outcome = await executeLeadCrmDeliveryJobById({
      serviceSupabase: supabase,
      workspaceId: WORKSPACE,
      jobId: probeJobId,
    });
  } finally {
    if (previous === undefined) delete process.env.BLOCKWISE_ENABLE_CRM_DELIVERY;
    else process.env.BLOCKWISE_ENABLE_CRM_DELIVERY = previous;
  }

  const job = await loadLeadCrmDeliveryJob({ serviceSupabase: supabase, workspaceId: WORKSPACE, jobId: probeJobId });
  const inCrm = csql(`select count(*) from \`tabCRM Lead\` where name = ${sql(outcome.crmLead)}`);
  return {
    ok: outcome.state === "delivered" && job?.state === "delivered" && job?.crm_lead === outcome.crmLead && Number(inCrm) === 1,
    detail: `outcome=${outcome.state} crm_lead=${outcome.crmLead} job_state=${job?.state} crm rows=${inCrm}`,
  };
});

await attempt("A32", "redelivering the same job does not capture the enquiry twice", async () => {
  if (!probeJobId) return { ok: false, detail: "A30 produced no delivery job, so there is nothing to redeliver" };

  const { executeLeadCrmDeliveryJobById } = await import("../../src/lib/crm/delivery-worker.ts");

  const previous = process.env.BLOCKWISE_ENABLE_CRM_DELIVERY;
  process.env.BLOCKWISE_ENABLE_CRM_DELIVERY = "true";
  let outcome;
  try {
    outcome = await executeLeadCrmDeliveryJobById({
      serviceSupabase: supabase,
      workspaceId: WORKSPACE,
      jobId: probeJobId,
    });
  } finally {
    if (previous === undefined) delete process.env.BLOCKWISE_ENABLE_CRM_DELIVERY;
    else process.env.BLOCKWISE_ENABLE_CRM_DELIVERY = previous;
  }

  const inCrm = csql(`select count(*) from \`tabCRM Lead\` where blockwise_source_key like ${sql(`%${STAMP}%`)}`);
  return {
    ok: outcome.created === false && Number(inCrm) === 1,
    detail: `created=${outcome.created} crm leads for this probe=${inCrm}`,
  };
});

await attempt("A33", "the customer's lead list renders the CRM handoff for that lead", async () => {
  if (!probeLeadId) return { ok: false, detail: "A30 produced no probe lead, so there is nothing to look for" };

  const { listLeadRowsWithDedupe } = await import("../../src/lib/operator/overview.ts");
  const { rows: leadRows } = await listLeadRowsWithDedupe(supabase, WORKSPACE);
  const row = leadRows.find((entry) => entry.id === probeLeadId);
  return {
    ok: Boolean(row?.crmDelivery),
    detail: row ? `lead=${row.id} crmDelivery="${row.crmDelivery}"` : `probe lead ${probeLeadId} not found in the list`,
  };
});

// =============================================================================
// G. The four customer-facing stages  (A34-A40)
// =============================================================================

group("G. The four customer-facing stages");

// A fresh enquiry, so the stage sequence runs from a known starting point:
// log_contact only advances New -> Contacting, it does not move a lead back.
let stageLead = null;

await attempt("A34", "the CRM's native stage master holds all four customer stages", async () => {
  const present = csql(
    "select lead_status from `tabCRM Lead Status` where lead_status in ('New','Contacted','Follow-up','Closed')",
  );
  const names = present.split("\n").map((line) => line.trim()).filter(Boolean).sort();
  return { ok: names.length === 4, detail: `found=${names.join(", ")}` };
});

await attempt("A35", "the legacy statuses are preserved alongside them", async () => {
  const legacy = csql("select lead_status from `tabCRM Lead Status` where position <= 7 order by position");
  const names = legacy.split("\n").map((line) => line.trim()).filter(Boolean);
  const total = csql("select count(*) from `tabCRM Lead Status`");
  return { ok: names.length === 7 && Number(total) >= 9, detail: `positions 1-7 = ${names.join(", ")}; total=${total}` };
});

await attempt("A36", "a new enquiry starts at the native stage New", async () => {
  const created = await commands.captureEnquiry({
    commandId: `${STAMP}-stage-capture`,
    sourceProvider: "meta",
    sourceSubmissionId: `${STAMP}-stage-sub`,
    firstName: "Stage",
    lastName: "Probe",
    email: `${STAMP}-stage@example.test`,
  });
  stageLead = created.lead;
  const native = csql(`select status from \`tabCRM Lead\` where name = ${sql(stageLead)}`);
  const readBack = await commands.getLead(stageLead);
  return {
    ok: native === "New" && readBack.customerStage === "New",
    detail: `lead=${stageLead} native=${native} adapter=${readBack.customerStage}`,
  };
});

await attempt("A37", "logging contact moves the native stage to Contacted", async () => {
  const before = await commands.getLead(stageLead);
  await commands.logContact({ commandId: `${STAMP}-stage-contact`, lead: stageLead, expectedRevision: before.revision });
  const native = csql(`select status from \`tabCRM Lead\` where name = ${sql(stageLead)}`);
  const readBack = await commands.getLead(stageLead);
  return {
    ok: native === "Contacted" && readBack.customerStage === "Contacted",
    detail: `native=${native} adapter=${readBack.customerStage} working=${readBack.stage}`,
  };
});

await attempt("A38", "booking an appointment moves the native stage to Follow-up", async () => {
  const before = await commands.getLead(stageLead);
  await commands.bookAppointment({
    commandId: `${STAMP}-stage-appointment`,
    lead: stageLead,
    expectedRevision: before.revision,
    appointmentAt: "2026-10-01 10:00:00",
  });
  const native = csql(`select status from \`tabCRM Lead\` where name = ${sql(stageLead)}`);
  const readBack = await commands.getLead(stageLead);
  return {
    ok: native === "Follow-up" && readBack.customerStage === "Follow-up",
    detail: `native=${native} adapter=${readBack.customerStage} working=${readBack.stage}`,
  };
});

await attempt("A39", "closing an enquiry moves the native stage to Closed", async () => {
  const before = await commands.getLead(stageLead);
  await commands.markOutcome({
    commandId: `${STAMP}-stage-outcome`,
    lead: stageLead,
    expectedRevision: before.revision,
    outcome: "Won",
  });
  const native = csql(`select status from \`tabCRM Lead\` where name = ${sql(stageLead)}`);
  const readBack = await commands.getLead(stageLead);
  return {
    ok: native === "Closed" && readBack.customerStage === "Closed",
    detail: `native=${native} adapter=${readBack.customerStage} working=${readBack.stage}`,
  };
});

await attempt("A40", "no lead in this workspace has drifted from its working stage", async () => {
  // The defect this matrix exists to catch: every lead read `New` natively
  // while blockwise_stage said otherwise, so a customer saw one stage for all
  // of them. Drift is counted, not assumed away.
  //
  // Scoped to the workspace under test, because `sync_customer_stages` is
  // workspace-scoped: a second customer's site data is theirs to repair, and
  // failing this workspace for their residue would be the wrong claim. The
  // site-wide figure is reported alongside so the residue stays visible.
  const driftFor = (where) =>
    csql(
      `select count(*) from \`tabCRM Lead\` where ${where} and ((blockwise_stage in ('Contacting','Engaged','Appointment booked') and status = 'New') or (blockwise_stage in ('Won','Lost') and status not in ('Closed','Converted')))`,
    );
  const totalFor = (where) => csql(`select count(*) from \`tabCRM Lead\` where ${where}`);

  const scope = `workspace_id = ${sql(WORKSPACE)}`;
  const workspaceLeads = totalFor(scope);
  const workspaceDrift = driftFor(scope);
  const siteDrift = driftFor("1 = 1");
  const siteLeads = totalFor("1 = 1");

  return {
    ok: Number(workspaceDrift) === 0,
    detail: `workspace: ${workspaceLeads} leads, ${workspaceDrift} drifted | site: ${siteLeads} leads, ${siteDrift} drifted`,
  };
});

// =============================================================================
// H. Isolation and permissions  (A41-A43)
// =============================================================================

group("H. Isolation and permissions");

await attempt("A41", "a workspace member may read their own delivery rows", async () => {
  const qual = psql(
    "select qual from pg_policies where schemaname='public' and tablename='lead_crm_delivery_jobs' and policyname='lead_crm_delivery_jobs_workspace_select'",
  );
  return { ok: /is_operator|is_workspace_member/i.test(qual), detail: qual || "(policy not found)" };
});

await attempt("A42", "a client cannot insert or update a delivery row", async () => {
  const found = psql(
    "select policyname from pg_policies where schemaname='public' and tablename='lead_crm_delivery_jobs' and cmd in ('INSERT','UPDATE') order by policyname",
  );
  const names = found.split("\n").map((line) => line.trim()).filter(Boolean);
  return {
    ok: names.length === 2 && names.every((name) => /no_client/.test(name)),
    detail: `insert/update policies: ${names.join(", ") || "(none)"}`,
  };
});

await attempt("A43", "another workspace is refused this enquiry while its owner is not", async () => {
  const other = psql(`select id from public.workspaces where id <> ${sql(WORKSPACE)} limit 1`);
  if (!other) return { ok: false, detail: "no second workspace exists to test with" };
  const refused = await api("get_lead", { workspace_id: other, lead: stageLead });
  const allowed = await api("get_lead", { workspace_id: WORKSPACE, lead: stageLead });
  return {
    ok: refused.status >= 400 && allowed.status === 200,
    detail: `other workspace status=${refused.status}; owner status=${allowed.status}`,
  };
});

// =============================================================================
// Cleanup items the handover named (reported separately from the matrix)
// =============================================================================

group("Cleanup (handover section 6, items G and H)");

await attempt("C01", "the demo credential file is gone now the vault holds the secret", async () => {
  const present = shell(`test -f ${CREDENTIAL_FILE} && echo yes || echo no`);
  return {
    ok: present === "no",
    detail: present === "no" ? "removed" : `still on disk: ${CREDENTIAL_FILE}`,
  };
});

await attempt("C02", "no throwaway CRM test container is left behind", async () => {
  const found = shell("docker ps -a --format '{{.Names}} {{.Status}}' | grep -E '^bw-crm-test' || true");
  return { ok: found === "", detail: found || "absent" };
});

// =============================================================================
// Residue and summary
// =============================================================================

// The probe lead is this run's own row, created above, and deleting it cascades
// the delivery job. Removing it is not optional: leaving it would put a lead in
// a customer's list that no customer captured.
if (probeLeadId) {
  try {
    psql(`delete from public.leads where id = ${sql(probeLeadId)}`);
    const orphanJobs = psql(`select count(*) from public.lead_crm_delivery_jobs where lead_id = ${sql(probeLeadId)}`);
    console.log(`\nprobe lead: removed ${probeLeadId}; delivery jobs left behind=${orphanJobs}`);
  } catch (error) {
    console.log(`\nprobe lead: NOT removed (${probeLeadId}): ${error?.message ?? error}`);
  }
}

try {
  const probeCount = Number(csql(`select count(*) from \`tabCRM Lead\` where blockwise_source_key like ${sql(`${STAMP}%`)}`));
  if (probeCount > 0 && process.env.ACCEPTANCE_CLEANUP === "1") {
    csql(`delete from \`tabCRM Lead\` where blockwise_source_key like ${sql(`${STAMP}%`)}`);
    console.log(`residue: removed ${probeCount} CRM probe lead(s) under ${STAMP}`);
  } else if (probeCount > 0) {
    console.log(`residue: ${probeCount} CRM probe lead(s) remain on ${SITE} under ${STAMP} (ACCEPTANCE_CLEANUP=1 removes them)`);
  }
} catch (error) {
  console.log(`residue: could not count CRM probe leads: ${error?.message ?? error}`);
}

const byGroup = new Map();
for (const row of rows) {
  if (!byGroup.has(row.group)) byGroup.set(row.group, { pass: 0, fail: 0 });
  const bucket = byGroup.get(row.group);
  if (row.ok) bucket.pass += 1;
  else bucket.fail += 1;
}

console.log("\n== summary ==");
for (const [name, { pass, fail }] of byGroup) {
  console.log(`  ${fail === 0 ? "ok  " : "FAIL"} ${name}: ${pass} pass, ${fail} fail`);
}

const failed = rows.filter((row) => !row.ok);
console.log(`\n==> ${rows.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) {
  console.error("\nACCEPTANCE FAILED");
  for (const row of failed) console.error(`  ${row.id}  ${row.description}\n      ${row.detail}`);
  process.exit(1);
}
console.log("ACCEPTANCE PASSED: the native-backed customer CRM is releasable.");
