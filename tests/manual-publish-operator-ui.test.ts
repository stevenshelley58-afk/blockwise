import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const componentPath = "src/app/(operator)/operator/customers/[workspaceId]/manual-publish-requests.tsx";
const pagePath = "src/app/(operator)/operator/customers/[workspaceId]/page.tsx";
const customersPath = "src/lib/operator/customers.ts";

test("operator customer detail loads and renders the manual publishing queue", async () => {
  const [page, component] = await Promise.all([readFile(pagePath, "utf8"), readFile(componentPath, "utf8")]);
  assert.match(page, /listManualPublishRequestsForWorkspace/);
  assert.match(page, /<ManualPublishRequests requests=\{manualPublishRequests\}/);
  assert.doesNotMatch(page, /MetaPartnerAssignment/);
  assert.match(component, /Manual Meta publishing requests/);
  assert.match(component, /\/api\/adstudio\/media\?path=.*workspaceId=/);
  assert.match(component, /encodeURIComponent\(path\)/);
  assert.match(component, /Publish setup captured from customer/);
  assert.match(component, /usesExistingAdSetSettings/);
});

test("open audited requests surface in the Meta help queue without activation schema changes", async () => {
  const customers = await readFile(customersPath, "utf8");
  assert.match(customers, /MANUAL_REQUEST_TARGET/);
  assert.match(customers, /hasOpenManualPublishRequest/);
  assert.match(customers, /status === "requested" \|\| status === "in_progress"/);
  assert.match(customers, /activation\?\.meta_help_selected_at \|\| manualPublishPending/);
  assert.doesNotMatch(customers, /meta_help_path === "manual_publish"/);
});

test("operator controls require reasons and distinguish manual completion from Meta connection", async () => {
  const component = await readFile(componentPath, "utf8");
  assert.match(component, /Add a reason before changing the request status/);
  assert.match(component, /Mark manually fulfilled/);
  assert.match(component, /never changes the customer’s Meta connection status/);
  assert.match(component, /method: "PATCH"/);
  assert.match(component, /status, reason/);
  assert.doesNotMatch(component, /Meta Connected/);
});
