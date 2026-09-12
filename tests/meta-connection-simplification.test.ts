import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("the ad-accounts card offers one Meta action and never asks for a separate save", () => {
  const connections = read("src/app/(customer)/settings/connections-section.tsx");

  // Connect when disconnected, Disconnect when connected. No Save button and
  // no second Reconnect button competing with the connection action. The word
  // may still appear in an error message; only a Reconnect control is banned.
  // The card has one provider, so the connect action is the only one on it.
  assert.match(connections, /<a href=\{metaConnectHref\}>Connect your Meta account<\/a>/);
  assert.match(connections, /Disconnect/);
  assert.doesNotMatch(connections, />\s*Reconnect\s*</);
  assert.doesNotMatch(connections, /Save Meta setup/);
  assert.doesNotMatch(connections, /<form/);
  // Asset choices are pulled from Meta and save themselves.
  assert.match(connections, /Each picker saves itself/);
  assert.match(connections, /method: "PATCH"/);
});

test("pulled Meta values never appear as editable fields on the connect card", () => {
  const connections = read("src/app/(customer)/settings/connections-section.tsx");

  // Currency and timezone come from the ad account and are re-checked live by
  // Meta at publish time, so they must not be typed in here.
  assert.doesNotMatch(connections, /id="meta-currency"/);
  assert.doesNotMatch(connections, /id="meta-timezone"/);
  // The privacy policy moved to the Workspace card.
  assert.doesNotMatch(connections, /id="meta-privacy-policy-url"/);
  // The lead destination moved with it.
  assert.doesNotMatch(connections, /id="meta-lead-destination-type"/);
});

test("a new or disconnected workspace shows blank publishing values, not invented ones", () => {
  const connections = read("src/app/(customer)/settings/connections-section.tsx");
  const emptySetup = connections.match(/function emptyMetaSetup\(\): MetaSetup \{[\s\S]*?\n\}/)?.[0] ?? "";

  assert.match(emptySetup, /currency: ""/);
  assert.match(emptySetup, /timezone: ""/);
  assert.doesNotMatch(emptySetup, /"AUD"|"Australia\/Perth"/);
});

test("the Workspace card owns publishing details and labels the pulled values", () => {
  const workspace = read("src/app/(customer)/settings/workspace-section.tsx");

  assert.match(workspace, /id="workspace-privacy-policy"/);
  assert.match(workspace, /id="workspace-lead-destination-type"/);
  // Sourced values are read-only and say where they came from.
  assert.match(workspace, /id="workspace-publishing-currency"[\s\S]{0,120}readOnly/);
  assert.match(workspace, /id="workspace-publishing-timezone"[\s\S]{0,120}readOnly/);
  assert.match(workspace, /Pulled directly from your Meta ad account\./);
  assert.match(workspace, /This will be pulled from your Meta ad account once one is connected\./);
  // They save themselves, so the card has no second Save button.
  assert.match(workspace, /\/api\/workspace\/publishing-defaults/);
});

test("the publishing-defaults route refuses to write the mirrored currency or timezone", () => {
  const route = read("src/app/api/workspace/publishing-defaults/route.ts");

  assert.match(route, /privacy_policy_url/);
  assert.match(route, /lead_destination_type/);
  assert.doesNotMatch(route, /publishing_currency/);
  assert.doesNotMatch(route, /publishing_timezone/);
});

test("a disconnected workspace can always restart the Meta sharing check", () => {
  const guide = read("src/components/meta/connect-meta-guide.tsx");
  const page = read("src/app/(customer)/connect-meta/page.tsx");

  // Without this the customer who disconnects lands on an old pending request
  // with no way back to the share checklist.
  assert.match(guide, /canRestart: boolean/);
  assert.match(guide, /canRestart \|\|/);
  assert.match(guide, /canRestart=\{!isConnected\}/);
  assert.match(page, /isConnected=\{isConnected\}/);
});
