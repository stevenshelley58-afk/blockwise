#!/usr/bin/env node
/**
 * Live end-to-end proof that Blockwise can command the CRM server-side.
 *
 * This is NOT part of `npm test`. It needs a running CRM stack and the product
 * database, so it runs on the VPS as a verification step, not in CI. Run it
 * after provisioning a site, and after any change to the adapter or to the
 * blockwise_crm command API.
 *
 * It exercises the REAL adapter (src/lib/crm/*) against the REAL Frappe, with
 * the workspace -> site mapping read from the REAL product database. The only
 * thing stood in for is the Supabase HTTP transport: the adapter's
 * site-resolution calls `supabase.from(...).select(...).eq(...).maybeSingle()`,
 * and that one shape is served here by a direct query, so the script can run
 * from the VPS host where PostgREST is not published.
 *
 * Every check asserts something observed. There are no unconditional passes.
 *
 * Usage, from the repository root on the VPS:
 *
 *   node --import tsx scripts/verify/crm-adapter-live.mjs <workspace-uuid>
 *
 * Environment:
 *   CRM_LIVE_BASE_URL     default http://127.0.0.1:8081
 *   CRM_LIVE_ENV_FILE     default /srv/blockwise/crm/deploy/.env
 *   PRODUCT_DB_CONTAINER  default blockwise-product-product-db-1
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { createWorkspaceCrm } from "../../src/lib/crm/index.ts";

const WORKSPACE_ID = process.argv[2];
if (!WORKSPACE_ID) {
  console.error("usage: node --import tsx scripts/verify/crm-adapter-live.mjs <workspace-uuid>");
  process.exit(2);
}

const BASE_URL = process.env.CRM_LIVE_BASE_URL ?? "http://127.0.0.1:8081";
const ENV_FILE = process.env.CRM_LIVE_ENV_FILE ?? "/srv/blockwise/crm/deploy/.env";
const DB_CONTAINER = process.env.PRODUCT_DB_CONTAINER ?? "blockwise-product-product-db-1";

function readEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (match) out[match[1]] = match[2].trim().replace(/^"|"$/g, "");
  }
  return out;
}

function psqlJson(sql) {
  const raw = execFileSync(
    "docker",
    ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "blockwise", "-t", "-A", "-c", sql],
    { encoding: "utf8" },
  ).trim();
  return raw ? JSON.parse(raw) : null;
}

/**
 * The one Supabase shape the adapter uses, served from the product database.
 * Deliberately narrow: any other table or method throws rather than quietly
 * returning nothing, so this proof cannot pass by failing to look.
 */
function supabaseShim() {
  return {
    from(table) {
      if (table !== "crm_workspace_sites") {
        throw new Error(`shim only serves crm_workspace_sites, asked for ${table}`);
      }
      const filters = [];
      const builder = {
        select() { return builder; },
        eq(column, value) { filters.push(`${column} = '${value}'`); return builder; },
        async maybeSingle() {
          const where = filters.length ? ` where ${filters.join(" and ")}` : "";
          return {
            data: psqlJson(
              `select row_to_json(t) from (select workspace_id, crm_site, status from public.crm_workspace_sites${where} limit 1) t;`,
            ),
            error: null,
          };
        },
      };
      return builder;
    },
  };
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`);
}

const crmEnv = readEnvFile(ENV_FILE);
const env = {
  ...process.env,
  CRM_BASE_URL: BASE_URL,
  CRM_API_KEY: crmEnv.CRM_API_KEY,
  CRM_API_SECRET: crmEnv.CRM_API_SECRET,
};

console.log(`==> workspace ${WORKSPACE_ID}`);
console.log(`==> crm       ${BASE_URL}`);

// --- resolve the site through the real adapter ------------------------------
const { mapping, commands } = await createWorkspaceCrm({
  supabase: supabaseShim(),
  workspaceId: WORKSPACE_ID,
  env,
});
console.log(`==> site      ${mapping.crmSite} (${mapping.status})`);
check("workspace resolves to a provisioned site", mapping.crmSite.endsWith(".crm.internal"), mapping.crmSite);
check("the adapter carries the workspace id", commands.workspaceId === WORKSPACE_ID);
check("the adapter carries the resolved site", commands.site === mapping.crmSite);

const health = await commands.health();
check("the command API reports healthy", health.ok === true, `site=${health.site}`);

// --- capture -----------------------------------------------------------------
const stamp = `live-${Date.now()}`;
const payload = {
  workspaceId: WORKSPACE_ID,
  sourceProvider: "meta",
  sourceSubmissionId: stamp,
  commandId: `live-${stamp}`,
  firstName: "Live",
  lastName: "Probe",
  email: `live-${stamp}@example.test`,
  propertyContext: "Live probe suburb",
};

const first = await commands.captureEnquiry(payload);
check("capture creates an enquiry", first.created === true, `lead=${first.lead}`);
check("a new enquiry starts at New", first.stage === "New", `stage=${first.stage}`);

// --- idempotency -------------------------------------------------------------
const replaySameId = await commands.captureEnquiry(payload);
check(
  "replaying the same command_id returns the stored result",
  replaySameId.created === true && replaySameId.lead === first.lead,
  `lead=${replaySameId.lead}`,
);

const replayNewId = await commands.captureEnquiry({ ...payload, commandId: `live-${stamp}-b` });
check(
  "a new command_id for the same submission does not duplicate",
  replayNewId.created === false && replayNewId.lead === first.lead,
  `lead=${replayNewId.lead}`,
);

// --- read back ---------------------------------------------------------------
const lead = await commands.getLead(first.lead);
check("the enquiry reads back by id", lead.name === first.lead);
check("the source provider is recorded", lead.sourceProvider === "meta", `provider=${lead.sourceProvider}`);
check(
  "the source submission id is recorded",
  lead.sourceSubmissionId === stamp,
  `submission=${lead.sourceSubmissionId}`,
);
check("the property context survives", lead.propertyContext === "Live probe suburb");
check("the enquiry starts unarchived", lead.archived === false);

// --- one first-contact task, created by capture ------------------------------
const tasksAtCapture = await commands.listTasks({ limit: 200 });
const firstContact = tasksAtCapture.filter(
  (t) => t.referenceDocname === first.lead && t.purpose === "first_contact",
);
check("capture created exactly one first-contact task", firstContact.length === 1, `found=${firstContact.length}`);

// --- a real transition, guarded by the revision ------------------------------
const contacted = await commands.logContact({
  commandId: `live-${stamp}-contact`,
  lead: first.lead,
  expectedRevision: lead.revision,
});
check("logging contact advances the stage", contacted.stage === "Contacting", `stage=${contacted.stage}`);

const tasksAfterContact = await commands.listTasks({ limit: 200 });
const stillOpen = tasksAfterContact.filter(
  (t) => t.referenceDocname === first.lead && t.purpose === "first_contact" && t.status !== "Done" && t.status !== "Canceled",
);
check("the first-contact task was completed, not duplicated", stillOpen.length === 0, `still open=${stillOpen.length}`);

let staleRejected = false;
let staleMessage = "";
try {
  await commands.logContact({
    commandId: `live-${stamp}-stale`,
    lead: first.lead,
    expectedRevision: lead.revision, // deliberately stale now
  });
} catch (error) {
  staleRejected = true;
  staleMessage = String(error?.message ?? error);
}
check("a stale expected_revision is rejected", staleRejected, staleMessage);

// --- the activity trail ------------------------------------------------------
const activities = await commands.listActivities(first.lead, 50);
const contactedEvent = activities.find((a) => a.type === "contacted");
check("the contact was written to the activity trail", Boolean(contactedEvent));
check("the activity names its source", contactedEvent?.source === "agent_reported", `source=${contactedEvent?.source}`);

// --- the list the customer surface reads -------------------------------------
const listed = await commands.listLeads({ limit: 100 });
check("the enquiry appears in the workspace list", listed.some((row) => row.name === first.lead), `count=${listed.length}`);

// --- isolation, asserted against the API rather than assumed ----------------
// The adapter always sends its own workspace id, so this is tested by calling
// the command API directly with a DIFFERENT workspace id for the same lead.
const other = psqlJson(
  `select json_build_object('id', id) from public.workspaces where id <> '${WORKSPACE_ID}' limit 1;`,
);
if (other?.id) {
  const response = await fetch(`${BASE_URL}/api/method/blockwise_crm.api.get_lead`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: mapping.crmSite,
      Authorization: `token ${env.CRM_API_KEY}:${env.CRM_API_SECRET}`,
    },
    body: JSON.stringify({ workspace_id: other.id, lead: first.lead }),
  });
  const text = await response.text();
  const refused = response.status >= 400 || /not found/i.test(text);
  check(
    "another workspace is refused the same enquiry",
    refused,
    `status=${response.status} ${text.slice(0, 120)}`,
  );
} else {
  check("another workspace is refused the same enquiry", false, "no second workspace to test with");
}

const failed = results.filter((r) => !r.ok);
console.log(`\n==> ${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) {
  console.error("LIVE PROOF FAILED");
  process.exit(1);
}
console.log("LIVE PROOF PASSED: Blockwise reaches and commands the CRM server-side.");
