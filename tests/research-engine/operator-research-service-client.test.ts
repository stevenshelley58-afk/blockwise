import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceClientRoutes = [
  "src/app/api/operator/research/jobs/route.ts",
  "src/app/api/operator/research/jobs/[id]/route.ts",
  "src/app/api/operator/research/runs/[id]/raw/route.ts",
  "src/app/api/operator/research/ads/[id]/display-state/route.ts",
  "src/app/api/operator/research/files/route.ts",
];

test("operator research table routes use the service-role research schema after the operator gate", () => {
  for (const routePath of serviceClientRoutes) {
    const route = readFileSync(routePath, "utf8");
    const guardIndex = route.indexOf("requireOperator()");
    const serviceResearchIndex = route.indexOf('createResearchServiceClient().schema("research")');

    assert.notEqual(guardIndex, -1, `${routePath} must keep the operator auth guard`);
    assert.notEqual(serviceResearchIndex, -1, `${routePath} must use the private VPS research client`);
    assert.ok(
      serviceResearchIndex > guardIndex,
      `${routePath} must create the service-role research schema client after requireOperator()`,
    );
    assert.doesNotMatch(
      route,
      /guard\.supabase[\s\S]{0,120}\.schema\(["']research["']\)/u,
      `${routePath} must not use the session client for research tables`,
    );
  }
});
