import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/adstudio/brand-studio.tsx", "utf8");
const page = readFileSync("src/app/(customer)/ad-studio/brand/page.tsx", "utf8");

test("Brand Studio explains the website-first setup path", () => {
  assert.match(source, /Enter your website\. We’ll build your brand kit\./);
  assert.match(source, /Build my brand kit/);
  assert.match(source, /Update from website/);
  assert.match(source, /htmlFor="brand-website"/);
  assert.match(source, /placeholder="e\.g\. youragency\.com\.au"/);
  assert.match(source, /type="submit"/);
});

test("Brand Studio keeps setup optional and treats missing persistence as a failure", () => {
  assert.match(source, /Optional setup/);
  assert.match(source, /You can skip this and keep generating ads/);
  assert.match(source, /payload\.persistence\?\.status === "not_persisted"/);
});

test("approving sends the edited website through the canonical approval endpoint", () => {
  assert.match(source, /source:\s*\{\s*\.\.\.kit\.source,\s*url:\s*sourceUrl\s*\}/);
  assert.match(source, /`\/api\/adstudio\/brand-kits\/\$\{kit\.brandKitId\}\/approve`/);
  assert.match(source, /method:\s*"POST"/);
  assert.match(source, /body:\s*JSON\.stringify\(\{ brandKit: submittedKit \}\)/);
  assert.match(source, /const savedKit = requirePersistedBrandKit/);
  assert.match(source, /setScanUrl\(savedKit\.source\.url/);
  assert.doesNotMatch(source, /Save draft/);
  assert.match(source, /router\.replace\(returnTo\)/);
  assert.match(source, /href=\{returnTo\}/);
});

test("Brand Studio accepts only an Ad Studio return path", () => {
  assert.match(page, /safeAdStudioReturnTo/);
  assert.match(page, /parsed\.pathname !== "\/ad-studio"/);
  assert.match(page, /returnTo=\{safeAdStudioReturnTo\(params\.returnTo\)\}/);
});

test("Brand Studio reloads the newest workspace kit instead of a campaign-linked kit", () => {
  assert.match(page, /loadLatestBrandKit/);
  assert.match(page, /\.order\("updated_at", \{ ascending: false \}\)/);
  assert.doesNotMatch(page, /loadLiveAdStudioBundle/);
});
