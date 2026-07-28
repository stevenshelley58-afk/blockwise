import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("operator pages render a friendly service-role configuration state", () => {
  const helper = readFileSync("src/lib/operator/service-role.ts", "utf8");
  const notice = readFileSync("src/components/operator/service-role-required.tsx", "utf8");
  const researchPage = readFileSync("src/app/(operator)/operator/research/page.tsx", "utf8");
  const contentRunsPage = readFileSync("src/app/(operator)/operator/content-runs/page.tsx", "utf8");
  const contentRunDetail = readFileSync("src/app/(operator)/operator/content-runs/[id]/page.tsx", "utf8");

  assert.match(helper, /createOperatorSupabaseServiceClient/);
  assert.match(helper, /isMissingSupabaseServiceRoleError/);
  assert.match(helper, /return null/);
  assert.match(notice, /Operator data is unavailable/);
  assert.match(notice, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(researchPage, /tryCreateResearchServiceClient\(\)/);
  assert.match(researchPage, /<ServiceRoleRequired \/>/);
  assert.match(contentRunsPage, /createOperatorSupabaseServiceClient\(\)/);
  assert.match(contentRunsPage, /<ServiceRoleRequired \/>/);
  assert.match(contentRunDetail, /createOperatorSupabaseServiceClient\(\)/);
  assert.match(contentRunDetail, /<ServiceRoleRequired \/>/);
});

test("content-run detail returns notFound only for unknown run ids", () => {
  const repository = readFileSync("src/lib/content-engine/repository.ts", "utf8");
  const page = readFileSync("src/app/(operator)/operator/content-runs/[id]/page.tsx", "utf8");

  assert.match(repository, /class ContentRunNotFoundError extends Error/);
  assert.match(repository, /maybeSingle\(\)/);
  assert.match(repository, /if \(!run\) throw new ContentRunNotFoundError\(runId\)/);
  assert.match(page, /import \{ notFound \} from "next\/navigation"/);
  assert.match(page, /error instanceof ContentRunNotFoundError/);
  assert.match(page, /notFound\(\)/);
  assert.match(page, /throw error/);
});
