import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const nextConfig = readFileSync("next.config.ts", "utf8");
const route = readFileSync("src/app/api/operator/research/skills/[slug]/route.ts", "utf8");
const hermesAssets = readFileSync("src/lib/operator/hermes-assets.ts", "utf8");

test("Next traces Hermes skills for operator research skill surfaces", () => {
  assert.match(nextConfig, /outputFileTracingIncludes:\s*\{/u);
  assert.ok(nextConfig.includes('"/operator/research": ["./hermes/skills/**/*"]'));
  assert.ok(nextConfig.includes('"/api/operator/research/skills": ["./hermes/skills/**/*"]'));
  assert.ok(nextConfig.includes('"/api/operator/research/skills/[slug]": ["./hermes/skills/**/*"]'));
});

test("operator skill route returns 404 for missing Hermes skills", () => {
  assert.match(route, /\bisMissingHermesSkillError\b/u);
  assert.match(route, /const loaded = await readSkillForRoute\(slug\);[\s\S]*if \(!loaded\.ok\) return loaded\.response/u);
  assert.match(route, /NextResponse\.json\(\{ error: "Hermes skill not found\." \}, \{ status: 404 \}\)/u);
  assert.match(hermesAssets, /error\.message === "Invalid Hermes skill slug\."/u);
  assert.match(hermesAssets, /code === "ENOENT" \|\| code === "ENOTDIR"/u);
});

test("operator research skills list includes every bundled Hermes skill", () => {
  const skills = readdirSync("hermes/skills", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^blockwise-[a-z0-9-]+$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  assert.equal(skills.length, 28);
  assert.ok(skills.includes("blockwise-agent-cleanup"));
  assert.ok(skills.includes("blockwise-location-ad-search"));
  assert.match(hermesAssets, /readdir\(SKILLS_ROOT, \{ withFileTypes: true \}\)/u);
  assert.match(hermesAssets, /readHermesSkill\(entry\.name\)/u);
});
