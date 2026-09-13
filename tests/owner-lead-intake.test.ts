import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyOwnerLeadIntakeRequest } from "../src/lib/owner-crm/auth.ts";
import { OWNER_CRM_LEAD_INTAKE_INTERNAL_SCOPE, mapOwnerLeadIntakeRow, parseOwnerLeadIntakePageRequest, readOwnerLeadIntakePage } from "../src/lib/owner-crm/lead-intake.ts";

const id = "11111111-1111-4111-8111-111111111111";
function row(overrides: Record<string, unknown> = {}) { return { id, created_at: "2026-09-13T00:00:00.000Z", name: "Request Owner", agency: "Example Agency", email: "request@example.invalid", phone: "+61400000000", suburb: "Perth", message: "Please review", source: "audit-pdf", ...overrides }; }

test("lead intake maps immutable demo request IDs without email identity merging", () => {
  const item = mapOwnerLeadIntakeRow(row() as never);
  assert.equal(item.sourceKey, `blockwise_demo_request:${id}`);
  assert.equal(item.sourceKind, "audit_request");
  assert.equal(item.lead.email, "request@example.invalid");
  assert.equal("profileId" in item, false);
  assert.equal(JSON.stringify(item).includes("stripe"), false);
  assert.throws(() => mapOwnerLeadIntakeRow(row({ source: "research-agent" }) as never), /invalid_demo_request_source/);
});

test("lead intake page is bounded, source-filtered, and cursor based on immutable ID", async () => {
  const calls: string[] = [];
  const result = await readOwnerLeadIntakePage({ from: () => {
    const query: any = { select: () => query, in: (_: string, values: string[]) => { calls.push(values.join(",")); return query; }, gt: (_: string, value: string) => { calls.push(value); return query; }, order: () => query, limit: async () => ({ data: [row()], error: null }) }; return query;
  } }, { afterId: id, limit: 1 });
  assert.deepEqual(calls, ["landing,audit-pdf", id]);
  assert.equal(result.items.length, 1); assert.equal(result.nextAfterId, id);
  assert.deepEqual(parseOwnerLeadIntakePageRequest(new URLSearchParams()), { afterId: null, limit: 50 });
  assert.throws(() => parseOwnerLeadIntakePageRequest(new URLSearchParams("limit=101")), /invalid_page_limit/);
  assert.throws(() => parseOwnerLeadIntakePageRequest(new URLSearchParams("afterId=nope")), /invalid_page_cursor/);
});

test("lead intake rejects bearer, shared, and snapshot credentials", async () => {
  const before = { lead: process.env.OWNER_LEAD_INTAKE_AUTH_SECRET, snapshot: process.env.OWNER_CRM_SNAPSHOT_AUTH_SECRET, shared: process.env.BLOCKWISE_INTERNAL_AUTH_SECRET };
  try {
    process.env.OWNER_LEAD_INTAKE_AUTH_SECRET = "lead-credential-012345678901234567890123456789";
    const bearer = await verifyOwnerLeadIntakeRequest(new Request("https://blockwise.test", { headers: { authorization: "Bearer nope" } }));
    assert.deepEqual(bearer, { ok: false, status: 401, error: "legacy_bearer_not_permitted" });
    let scope = ""; await verifyOwnerLeadIntakeRequest(new Request("https://blockwise.test"), async (_r, receivedScope, options) => { scope = receivedScope; assert.equal(options?.secret, process.env.OWNER_LEAD_INTAKE_AUTH_SECRET); return { ok: true, scope: receivedScope }; });
    assert.equal(scope, OWNER_CRM_LEAD_INTAKE_INTERNAL_SCOPE);
    process.env.OWNER_CRM_SNAPSHOT_AUTH_SECRET = process.env.OWNER_LEAD_INTAKE_AUTH_SECRET;
    assert.deepEqual(await verifyOwnerLeadIntakeRequest(new Request("https://blockwise.test")), { ok: false, status: 503, error: "dedicated_secret_required" });
  } finally { for (const [key, value] of Object.entries(before)) { const envKey = key === "lead" ? "OWNER_LEAD_INTAKE_AUTH_SECRET" : key === "snapshot" ? "OWNER_CRM_SNAPSHOT_AUTH_SECRET" : "BLOCKWISE_INTERNAL_AUTH_SECRET"; if (value === undefined) delete process.env[envKey]; else process.env[envKey] = value; } }
});

test("lead intake route is no-store and does not log source errors", () => {
  const route = readFileSync(new URL("../src/app/api/internal/ops/owner-lead-intake/route.ts", import.meta.url), "utf8");
  assert.match(route, /Cache-Control.: .no-store/); assert.match(route, /console\.error\("\[owner-lead-intake\] read failed"\)/); assert.doesNotMatch(route, /console\.error\([^\n]*error/);
  const compose = readFileSync(new URL("../infra/coolify/docker-compose.product.yml", import.meta.url), "utf8");
  const product = readFileSync(new URL("../infra/product/.env.example", import.meta.url), "utf8");
  assert.match(compose, /OWNER_LEAD_INTAKE_AUTH_SECRET: \$\{OWNER_LEAD_INTAKE_AUTH_SECRET:-\}/); assert.match(product, /^OWNER_LEAD_INTAKE_AUTH_SECRET=replace-in-infisical$/m);
});