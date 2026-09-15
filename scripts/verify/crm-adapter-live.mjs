#!/usr/bin/env node
/**
 * Live end-to-end proof that Blockwise can command the CRM server-side.
 *
 * This is NOT part of `npm test`. It needs a running product stack and a
 * running CRM, so it runs on the VPS as a verification step, not in CI.
 *
 * It exercises the REAL adapter (src/lib/crm/*) against the REAL Frappe, with
 * the workspace -> site mapping and the per-site credential read through the
 * REAL Supabase client from the REAL product database. Nothing is stubbed.
 *
 * Run it from a container on the product's compose network, which is where the
 * product's own server-side code runs:
 *
 *   docker run --rm --network blockwise-product \
 *     -e PRODUCT_SUPABASE_URL=http://product-rest:3000 \
 *     -e PRODUCT_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
 *     -e TOKEN_ENCRYPTION_KEY="$TOKEN_ENCRYPTION_KEY" \
 *     -v "$PWD":/app -w /app node:22-bookworm \
 *     node --import tsx scripts/verify/crm-adapter-live.mjs <workspace-uuid>
 *
 * TOKEN_ENCRYPTION_KEY is required because the credential is decrypted from the
 * vault; it is the same key the product app already uses.
 *
 * Environment:
 *   PRODUCT_SUPABASE_URL      e.g. http://product-rest:3000   (required)
 *   PRODUCT_SERVICE_ROLE_KEY  service role key                (required)
 *   CRM_BASE_URL              default http://blockwise-crm-backend:8000
 *   CRM_LIVE_STRICT           set to 0 to warn instead of failing on the
 *                             cross-tenant check
 *
 * The credential is read from the encrypted vault for this workspace, exactly
 * as the product does. There is deliberately no deployment-wide key/secret to
 * pass, because there is no deployment-wide credential any more.
 *
 * Every check asserts something observed. There are no unconditional passes.
 */

import { createClient } from "@supabase/supabase-js";

import { loadCrmSiteCredential } from "../../src/lib/crm/credentials.ts";
import { createWorkspaceCrm } from "../../src/lib/crm/index.ts";

const WORKSPACE_ID = process.argv[2];
if (!WORKSPACE_ID) {
  console.error("usage: node --import tsx scripts/verify/crm-adapter-live.mjs <workspace-uuid>");
  process.exit(2);
}

const BASE_URL = process.env.CRM_BASE_URL ?? "http://blockwise-crm-backend:8000";
const env = { ...process.env, CRM_BASE_URL: BASE_URL };

const SUPABASE_URL = process.env.PRODUCT_SUPABASE_URL;
const SERVICE_KEY = process.env.PRODUCT_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("PRODUCT_SUPABASE_URL and PRODUCT_SERVICE_ROLE_KEY are required");
  process.exit(2);
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`);
}

console.log(`==> workspace ${WORKSPACE_ID}`);
console.log(`==> crm       ${BASE_URL}`);
console.log(`==> mapping   ${SUPABASE_URL}`);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// --- the mapping row itself, through the real client -------------------------
const { data: mappingRow, error: mappingError } = await supabase
  .from("crm_workspace_sites")
  .select("workspace_id, crm_site, status")
  .eq("workspace_id", WORKSPACE_ID)
  .maybeSingle();
check(
  "the workspace has a site mapping row",
  Boolean(mappingRow?.crm_site) && !mappingError,
  mappingError ? mappingError.message : `site=${mappingRow?.crm_site} status=${mappingRow?.status}`,
);

// --- the credential is per workspace, held in the vault ----------------------
const credential = await loadCrmSiteCredential(supabase, WORKSPACE_ID);
check(
  "the workspace has its own stored credential",
  Boolean(credential?.apiKey && credential?.apiSecret),
);
check(
  "no deployment-wide credential is present in the environment",
  !process.env.CRM_API_KEY && !process.env.CRM_API_SECRET,
  process.env.CRM_API_KEY ? "CRM_API_KEY is still set in the environment" : "",
);

if (!credential) {
  console.error("This workspace has no stored CRM credential; provision it before running the live proof.");
  process.exit(1);
}

// --- resolve the site through the real adapter ------------------------------
const { mapping, commands } = await createWorkspaceCrm({
  supabase,
  workspaceId: WORKSPACE_ID,
  env,
});
console.log(`==> site      ${mapping.crmSite} (${mapping.status})`);
check("the adapter resolves the mapped site", mapping.crmSite === mappingRow.crm_site);
check("the adapter carries the workspace id", commands.workspaceId === WORKSPACE_ID);

// --- the API answers, on the right site -------------------------------------
const health = await commands.health();
check("the command API reports healthy", health.ok === true, `site=${health.site}`);
check(
  "the command API answers for the MAPPED site, not a default",
  health.site === mapping.crmSite,
  `reported=${health.site} expected=${mapping.crmSite}`,
);

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
check("the source submission id is recorded", lead.sourceSubmissionId === stamp);
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
// Naming a DIFFERENT workspace for the same lead must not disclose it. This is
// the check that would have caught the routing bug: with every request landing
// on one site, it passed for the wrong reason.
const { data: otherWorkspaces } = await supabase
  .from("workspaces")
  .select("id")
  .neq("id", WORKSPACE_ID)
  .limit(1);
const otherId = otherWorkspaces?.[0]?.id;

if (otherId) {
  const response = await fetch(`${BASE_URL}/api/method/blockwise_crm.api.get_lead`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Frappe-Site-Name": mapping.crmSite,
      Authorization: `token ${credential.apiKey}:${credential.apiSecret}`,
    },
    body: JSON.stringify({ workspace_id: otherId, lead: first.lead }),
  });
  const text = await response.text();
  check(
    "another workspace is refused the same enquiry",
    response.status >= 400 || /not found/i.test(text),
    `status=${response.status} ${text.slice(0, 100)}`,
  );

  // And the same workspace still can read it, so the refusal above is about
  // scope and not about the call simply being broken.
  const allowed = await fetch(`${BASE_URL}/api/method/blockwise_crm.api.get_lead`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Frappe-Site-Name": mapping.crmSite,
      Authorization: `token ${credential.apiKey}:${credential.apiSecret}`,
    },
    body: JSON.stringify({ workspace_id: WORKSPACE_ID, lead: first.lead }),
  });
  check("the owning workspace can still read it", allowed.ok, `status=${allowed.status}`);
} else {
  check("another workspace is refused the same enquiry", false, "no second workspace to test with");
}

const failed = results.filter((r) => !r.ok);
console.log(`\n==> ${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) {
  console.error("LIVE PROOF FAILED");
  process.exit(1);
}
console.log("LIVE PROOF PASSED: Blockwise reaches and commands the CRM server-side, on the mapped site.");
