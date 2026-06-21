import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeDraftCheckResult, runDraftCheckPropertyCheck } from "../src/lib/property-check/adapter.ts";
import { propertyCheckCreateSchema } from "../src/lib/property-check/schema.ts";
import {
  PROPERTY_CHECK_NO_SOURCE_MESSAGE,
  PROPERTY_CHECK_UNAVAILABLE_MESSAGE,
  type DraftCheckResult,
  type DraftCheckRequest,
} from "../src/lib/property-check/types.ts";

const validRequest: DraftCheckRequest = {
  workspaceId: "workspace_1",
  userId: "user_1",
  address: "12 Example Street, Suburb WA",
  clientSituation: "seller_appraisal",
  notes: "Seller asked about subdivision signals.",
};

const successSignal = {
  id: "zone-signal",
  title: "Residential zoning signal",
  summary: "The cited source identifies residential zoning for conversation prep.",
  citationIds: ["council-scheme"],
};

const successConstraint = {
  id: "overlay-check",
  title: "Overlay review",
  summary: "The cited source should be reviewed before relying on renovation notes.",
  citationIds: ["council-scheme"],
};

const successPayload: DraftCheckResult = {
  status: "success",
  normalizedFacts: {
    zone: "Residential",
    rCode: "R40",
    lotAreaM2: 720,
  },
  signals: [successSignal],
  likelyConstraints: [successConstraint],
  talkingPoints: ["Ask the client whether they have recent survey or council correspondence."],
  citations: [
    {
      id: "council-scheme",
      title: "Council planning source",
      sourceType: "planning_scheme",
      url: "https://example.com/planning",
    },
  ],
  disclaimer: "Preliminary planning signals only. Review source links before relying on results.",
  confidence: "medium",
  engineRequestId: "engine-request-1",
};

test("property check request schema accepts valid inputs and rejects invalid client situations", () => {
  assert.equal(propertyCheckCreateSchema.safeParse({ address: " 12 Example Street ", clientSituation: "buyer_question" }).success, true);
  assert.equal(propertyCheckCreateSchema.safeParse({ address: "12 Example Street", clientSituation: "designer_review" }).success, false);
  assert.equal(propertyCheckCreateSchema.safeParse({ address: "A", clientSituation: "general" }).success, false);
});

test("adapter sends a server-side engine request and normalizes a cited success", async () => {
  let capturedUrl = "";
  let capturedBody: unknown = null;
  let capturedAuth = "";

  const result = await runDraftCheckPropertyCheck(validRequest, {
    env: {
      DRAFTCHECK_ENGINE_BASE_URL: "https://engine.example.test/",
      DRAFTCHECK_ENGINE_TOKEN: "secret-token",
      DRAFTCHECK_ENGINE_TIMEOUT_MS: "5000",
    },
    now: () => "2026-06-21T00:00:00.000Z",
    fetcher: async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      capturedAuth = String(new Headers(init?.headers).get("authorization"));
      return new Response(JSON.stringify(successPayload), { status: 200 });
    },
  });

  assert.equal(capturedUrl, "https://engine.example.test/api/v1/agent-property-check");
  assert.deepEqual(capturedBody, validRequest);
  assert.equal(capturedAuth, "Bearer secret-token");
  assert.equal(result.status, "success");
  assert.equal(result.engineStatus, "success");
  assert.equal(result.signals[0]?.citationIds[0], "council-scheme");
  assert.equal(result.citations[0]?.id, "council-scheme");
});

test("adapter fails closed when engine config is missing or unavailable", async () => {
  let called = false;
  const missingConfig = await runDraftCheckPropertyCheck(validRequest, {
    env: {},
    fetcher: async () => {
      called = true;
      return new Response("{}", { status: 200 });
    },
  });

  assert.equal(called, false);
  assert.equal(missingConfig.status, "engine_unavailable");
  assert.equal(missingConfig.message, PROPERTY_CHECK_UNAVAILABLE_MESSAGE);

  const unavailable = await runDraftCheckPropertyCheck(validRequest, {
    env: {
      DRAFTCHECK_ENGINE_BASE_URL: "https://engine.example.test",
      DRAFTCHECK_ENGINE_TOKEN: "secret-token",
    },
    fetcher: async () => new Response("{}", { status: 503 }),
  });

  assert.equal(unavailable.status, "engine_unavailable");
  assert.equal(unavailable.message, PROPERTY_CHECK_UNAVAILABLE_MESSAGE);
});

test("adapter rejects no-source, unsupported, low-confidence, and uncited planning output", () => {
  assert.equal(
    normalizeDraftCheckResult({ ...successPayload, status: "no_source" }).message,
    PROPERTY_CHECK_NO_SOURCE_MESSAGE,
  );
  assert.equal(normalizeDraftCheckResult({ ...successPayload, status: "unsupported" }).status, "unsupported");
  assert.equal(normalizeDraftCheckResult({ ...successPayload, confidence: "low" }).status, "no_source");
  assert.equal(normalizeDraftCheckResult({ ...successPayload, citations: [] }).engineStatus, "missing_citations");
  assert.equal(
    normalizeDraftCheckResult({
      ...successPayload,
      signals: [{ ...successSignal, citationIds: [] }],
    }).engineStatus,
    "invalid_citations",
  );
  assert.equal(
    normalizeDraftCheckResult({
      ...successPayload,
      likelyConstraints: [{ ...successConstraint, citationIds: ["missing-citation"] }],
    }).engineStatus,
    "invalid_citations",
  );
});

test("property check implementation does not use a fallback model for planning facts", () => {
  const adapter = readFileSync("src/lib/property-check/adapter.ts", "utf8");
  const route = readFileSync("src/app/api/property-checks/route.ts", "utf8");
  const combined = `${adapter}\n${route}`;

  assert.doesNotMatch(combined, /createTextProvider|ai-providers|OPENAI|model-profile|structured_json|fallback LLM/i);
});

test("property check persistence and RLS stay workspace scoped", () => {
  const migration = readFileSync("supabase/migrations/20260621120000_property_checks.sql", "utf8");
  const persistence = readFileSync("src/lib/property-check/persistence.ts", "utf8");
  const route = readFileSync("src/app/api/property-checks/route.ts", "utf8");

  assert.match(migration, /create table if not exists public\.property_checks/);
  assert.match(migration, /alter table public\.property_checks enable row level security/);
  assert.match(migration, /private\.has_workspace_role\(workspace_id, array\['owner', 'admin', 'member', 'operator'\]\)/);
  assert.doesNotMatch(migration, /public\.is_workspace_member|public\.has_workspace_role/);
  assert.match(persistence, /\.eq\("workspace_id", workspaceId\)/);
  assert.match(route, /requireApiWorkspace\(request, "property_check"\)/);
});

test("property check navigation is exposed to builder surfaces only", () => {
  const sidebar = readFileSync("src/components/sidebar-nav.tsx", "utf8");
  const selfServeBlock = sidebar.match(/const selfServeNavItems[\s\S]*?const monitorNavItems/)?.[0] ?? "";
  const operatorBlock = sidebar.match(/const operatorNavItems[\s\S]*?const selfServeNavItems/)?.[0] ?? "";
  const monitorBlock = sidebar.match(/const monitorNavItems[\s\S]*?export const navByVariant/)?.[0] ?? "";

  assert.match(selfServeBlock, /href: "\/property-check", label: "Property Check"/);
  assert.match(operatorBlock, /href: "\/property-check", label: "Property Check"/);
  assert.doesNotMatch(monitorBlock, /\/property-check/);
});
