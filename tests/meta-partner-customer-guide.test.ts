import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("the Meta walkthrough carries four real screenshots and next/image", () => {
  const steps = read("src/components/meta/partner-steps.ts");
  const shot = read("src/components/meta/guide-shot.tsx");
  const help = read("src/app/(customer)/help/page.tsx");
  assert.match(shot, /next\/image/);
  assert.match(help, /GuideShot/);
  const imageRefs = [
    "/help/meta/partner-access/01-partners.webp",
    "/help/meta/partner-access/02-give-access.webp",
    "/help/meta/partner-access/03-business-id.webp",
    "/help/meta/partner-access/04-assets-and-permissions.webp",
  ];
  for (const ref of imageRefs) {
    assert.match(steps, new RegExp(ref.replaceAll("/", "\\/")));
    const asset = path.join(root, "public", ref);
    assert.ok(fs.existsSync(asset), `screenshot asset missing: ${ref}`);
  }
});

test("tips and the Business ID live in Help, not on the connect screen", () => {
  const guide = read("src/components/meta/connect-meta-guide.tsx");
  const help = read("src/app/(customer)/help/page.tsx");
  const steps = read("src/components/meta/partner-steps.ts");

  // The connect screen is a checklist plus one confirmation.
  assert.match(guide, /META_PARTNER_STEPS/);
  assert.match(guide, /Confirm my sharing/);
  assert.doesNotMatch(guide, /<Input/);
  assert.doesNotMatch(guide, /Ad account ID|Page ID/);
  assert.doesNotMatch(guide, /Before you start/);

  // Help owns the walkthrough: screenshots, the ID and the permission detail.
  assert.match(help, /CopyBusinessId/);
  assert.match(steps, /Blockwise Business ID/);
  assert.match(steps, /Leave Full control off/);
  assert.match(steps, /Partners is missing/);
});

test("the customer flow names the sharing contract honestly", () => {
  const guide = read("src/components/meta/connect-meta-guide.tsx");
  const steps = read("src/components/meta/partner-steps.ts");
  const page = read("src/app/(customer)/connect-meta/page.tsx");
  const settings = read("src/app/(customer)/settings/connections-section.tsx");
  const combined = `${guide}\n${steps}\n${page}\n${settings}`;
  assert.match(combined, /business\.facebook\.com\/settings\/partners/);
  assert.match(combined, /share|sharing/i);
  assert.match(combined, /owner|admin/i);
  assert.match(combined, /operator/i);
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
