import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("customer Meta guide uses four real screenshots and next/image", () => {
  const source = read("src/components/meta/connect-meta-guide.tsx");
  assert.match(source, /next\/image/);
  const imageRefs = [
    "/help/meta/partner-access/01-partners.webp",
    "/help/meta/partner-access/02-give-access.webp",
    "/help/meta/partner-access/03-business-id.webp",
    "/help/meta/partner-access/04-assets-and-permissions.webp",
  ];
  for (const ref of imageRefs) {
    assert.match(source, new RegExp(ref.replaceAll("/", "\\/")));
    const asset = path.join(root, "public", ref);
    assert.ok(fs.existsSync(asset), `screenshot asset missing: ${ref}`);
  }
});

test("customer guide contains the partner sharing contract and honest manual handoff", () => {
  const guide = read("src/components/meta/connect-meta-guide.tsx");
  const page = read("src/app/(customer)/connect-meta/page.tsx");
  const settings = read("src/app/(customer)/settings/connections-section.tsx");
  const combined = `${guide}\n${page}\n${settings}`;
  assert.match(combined, /Business ID/i);
  assert.match(combined, /business\.facebook\.com\/settings\/partners/);
  assert.match(combined, /adAccountId|ad account/i);
  assert.match(combined, /pageId|Page ID/i);
  assert.match(combined, /instagramAccountId|Instagram/i);
  assert.match(combined, /owner|admin/i);
  assert.match(combined, /manual|operator/i);
  assert.match(combined, /Share Meta assets|share.*assets/i);
  assert.doesNotMatch(guide, /claimMeta|partner-claim/i);
  assert.doesNotMatch(guide, /Meta is connected/i);
});

test("legacy partner routes fail closed before config or database access", () => {
  const routes = [
    "src/app/api/integrations/meta/partner-accounts/route.ts",
    "src/app/api/integrations/meta/partner-claim/route.ts",
    "src/app/api/operator/customers/[workspaceId]/meta-partner-assignment/route.ts",
  ];
  for (const file of routes) {
    const source = read(file);
    const gate = source.indexOf("isMetaPartnerStartEnabled");
    assert.ok(gate >= 0, `${file} must call the feature gate`);
    const config = source.indexOf("getMetaPartnerConfig()");
    assert.ok(
      config < 0 || gate < config,
      `${file} must gate before config lookup`,
    );
    const db = source.search(
      /\.from\(["'](?:meta_partner|provider_connections)/,
    );
    assert.ok(
      db < 0 || gate < db,
      `${file} must gate before partner DB access`,
    );
  }
});
