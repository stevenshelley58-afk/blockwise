import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  adRadarSignupMetadata,
  normalizeAdRadarPostcode,
  readAdRadarSignupContext,
} from "../src/lib/research/ad-radar-signup.ts";
import {
  buildCustomerInterestRows,
  syncCustomerAdRadarInterests,
  customerInterestKey,
  extractContactPostcode,
  type CustomerFetch,
  type CustomerRestInit,
  type ResearchRest,
  type CustomerFetchResponse,
} from "../hermes/tools/research-runtime/bin/customer-freshness-sync.mjs";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";
const pageId = "33333333-3333-4333-8333-333333333333";

test("signup context keeps only an explicit suburb-report postcode", () => {
  assert.equal(normalizeAdRadarPostcode("6160"), "6160");
  assert.equal(normalizeAdRadarPostcode(" 6160 "), "6160");
  assert.equal(normalizeAdRadarPostcode("616"), null);
  assert.equal(normalizeAdRadarPostcode("6160x"), null);
  assert.deepEqual(readAdRadarSignupContext("?src=suburb-report&postcode=6160&intent=track"), {
    postcode: "6160", source: "suburb-report", intent: "track",
  });
  assert.deepEqual(adRadarSignupMetadata("?src=other&postcode=6160&intent=unknown"), {
    ad_radar_postcode: "6160",
  });
});

test("signup forwards the explicit Ad Radar context without collecting identity guesses", () => {
  const source = readFileSync("src/components/signup-form.tsx", "utf8");
  assert.match(source, /adRadarSignupMetadata\(location\.search\)/);
  assert.match(source, /signup_flow:\s*"trial_self_serve"/);
  assert.doesNotMatch(source, /agency_name/);
});

test("customer source migration captures signups privately and replay-safely", () => {
  const sql = readFileSync("supabase/migrations/202609080001_ad_radar_customer_interest_source.sql", "utf8");
  assert.match(sql, /create table(?: if not exists)? public\.ad_radar_customer_interest_sources/i);
  assert.match(sql, /profile_id uuid primary key references public\.profiles/i);
  assert.match(sql, /postcode text/i);
  assert.ok(sql.includes("^[0-9]{4}$"));
  assert.match(sql, /alter table public\.ad_radar_customer_interest_sources enable row level security/i);
  assert.match(sql, /revoke all on public\.ad_radar_customer_interest_sources from public, anon, authenticated/i);
  assert.match(sql, /grant all on public\.ad_radar_customer_interest_sources to service_role/i);
  assert.match(sql, /create or replace function private\.capture_ad_radar_signup_interest/i);
  assert.match(sql, /after insert on public.profiles/i);
  assert.match(sql, /on conflict \(profile_id\) do update/i);
});

test("research interest migration is private and requires a target", () => {
  const sql = readFileSync("infra/research-db/migrations/202609080001_research_ad_radar_customer_interests.sql", "utf8");
  assert.match(sql, /create table if not exists research\.ad_radar_customer_interests/i);
  assert.match(sql, /customer_key text primary key/i);
  assert.match(sql, /agent_id uuid references research\.agents/i);
  assert.match(sql, /advertiser_page_id uuid references research\.advertiser_pages/i);
  assert.match(sql, /postcode text/i);
  assert.match(sql, /agent_id is not null or advertiser_page_id is not null or postcode is not null/i);
  assert.match(sql, /revoke all on research\.ad_radar_customer_interests from public, anon, authenticated/i);
});

test("freshness rows use only existing explicit agent/page IDs and never name matching", () => {
  assert.equal(extractContactPostcode({ address: "Unit 12, 1234 Long Street, Fremantle WA 6160" }), "6160");
  assert.equal(extractContactPostcode({ address: "1234 Example Street, Perth 6000" }), "6000");
  assert.equal(extractContactPostcode({ address: "Perth 6000 Australia" }), "6000");
  assert.equal(extractContactPostcode({ address: { postalCode: "6000" } }), "6000");
  assert.equal(extractContactPostcode({ address: "No postcode" }), null);
  const rows = buildCustomerInterestRows({
    sources: [{
      profile_id: "44444444-4444-4444-8444-444444444444",
      postcode: "6160",
      agent_id: agentId,
      advertiser_page_id: pageId,
      active: true,
    }],
    owners: [{ profile_id: "44444444-4444-4444-8444-444444444444", workspace_id: workspaceId, role: "owner" }],
    brandKits: [],
    knownAgentIds: new Set([agentId]),
    knownPageIds: new Set(),
    customerKeySecret: "0123456789abcdef0123456789abcdef",
    now: "2026-09-08T00:00:00.000Z",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].agent_id, agentId);
  assert.equal(rows[0].advertiser_page_id, null);
  assert.equal(rows[0].postcode, "6160");
  assert.equal(rows[0].active, true);
  assert.match(rows[0].customer_key, /^v1:[0-9a-f]{64}$/);
  assert.doesNotMatch(rows[0].customer_key, new RegExp(workspaceId, "i"));
  assert.notEqual(customerInterestKey(workspaceId, "0123456789abcdef0123456789abcdef"), workspaceId);
});

test("freshness rows can fall back to an existing brand contact postcode", () => {
  const rows = buildCustomerInterestRows({
    sources: [],
    owners: [{ profile_id: "profile-fallback", workspace_id: workspaceId, role: "owner" }],
    brandKits: [{
      workspace_id: workspaceId,
      market_region: "WA",
      contact_json: { address: "10 Market St Perth WA 6000" },
      updated_at: "2026-09-08T00:00:00.000Z",
    }],
    customerKeySecret: "0123456789abcdef0123456789abcdef",
    now: "2026-09-08T00:00:00.000Z",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].postcode, "6000");
  assert.equal(rows[0].state, "WA");
});

test("exact connected page mapping wins without using the market marker as a state", () => {
  const rows = buildCustomerInterestRows({
    sources: [],
    owners: [{ profile_id: "profile-connected", workspace_id: workspaceId, role: "owner" }],
    brandKits: [{ workspace_id: workspaceId, market_region: "AU", contact_json: {}, updated_at: "2026-09-08T00:00:00.000Z" }],
    assignedPageIds: new Map([[workspaceId, pageId]]),
    knownPageIds: new Set([pageId]),
    customerKeySecret: "0123456789abcdef0123456789abcdef",
    now: "2026-09-08T00:00:00.000Z",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].advertiser_page_id, pageId);
  assert.equal(rows[0].postcode, null);
  assert.equal(rows[0].state, null);
});


function responseJson(value: unknown, status = 200): CustomerFetchResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(value) };
}

type ResearchWrite = { path: string; body: Array<Record<string, unknown>> | null };

function parseWriteBody(body: string | undefined): Array<Record<string, unknown>> {
  assert.ok(body);
  const parsed: unknown = JSON.parse(body);
  assert.ok(Array.isArray(parsed));
  return parsed as Array<Record<string, unknown>>;
}

function requiredString(value: unknown): string {
  assert.equal(typeof value, "string");
  return value as string;
}

function recordValue(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

test("sync registers an exact assigned Meta page once and follows changed profile postcode", async () => {
  const assignmentPageId = "99887766";
  const registeredPageId = "55555555-5555-4555-8555-555555555555";
  let kitPostcode = "6160";
  const researchWrites: ResearchWrite[] = [];
  const knownPages = new Map<string, string>();
  const env = {
    HERMES_CUSTOMER_SUPABASE_URL: "https://customer.example",
    HERMES_CUSTOMER_SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    HERMES_AD_RADAR_CUSTOMER_KEY_SECRET: "0123456789abcdef0123456789abcdef",
  };
    const fetchImpl: CustomerFetch = async (url, init: CustomerRestInit = {}) => {
    const relation = new URL(url).pathname.split("/").at(-1);
    if (relation === "ad_radar_customer_interest_sources") {
      return responseJson([{ profile_id: "profile-connected", postcode: "6000", source: "signup", active: true }]);
    }
    if (relation === "workspace_members") {
      return responseJson([{ profile_id: "profile-connected", workspace_id: workspaceId, role: "owner" }]);
    }
    if (relation === "adstudio_brand_kits") {
      return responseJson([{ workspace_id: workspaceId, market_region: "WA", contact_json: { address: "10 Market St Perth WA " + kitPostcode }, updated_at: kitPostcode }]);
    }
    if (relation === "meta_partner_account_assignments") {
      return responseJson([{ workspace_id: workspaceId, page_id: assignmentPageId, page_name: "Verified Agent Page", updated_at: "2026-09-08T00:00:00.000Z" }]);
    }
    throw new Error("unexpected product relation " + relation);
  };
  const researchRest: ResearchRest = async (_schema, path, init: CustomerRestInit = {}) => {
    if (init.method) researchWrites.push({ path, body: init.body ? parseWriteBody(init.body) : null });
    if (path.startsWith("agents?")) return [];
    if (path.startsWith("advertiser_pages?select=id,page_id")) {
      return [...knownPages].map(([page_id, id]) => ({ page_id, id }));
    }
    if (path.startsWith("advertiser_pages?on_conflict=")) {
      const rows = parseWriteBody(init.body);
      for (const row of rows) knownPages.set(requiredString(row.page_id), registeredPageId);
      return rows.map((row) => ({ id: registeredPageId, page_id: row.page_id }));
    }
    if (path.startsWith("ad_radar_customer_interests?select=")) return [];
    if (path.startsWith("ad_radar_customer_interests?on_conflict=")) return [];
    throw new Error("unexpected research path " + path);
  };

  await syncCustomerAdRadarInterests({ researchRest, fetchImpl, env, now: "2026-09-08T01:00:00.000Z" });
  const registrationWrites = researchWrites.filter((write) => write.path.startsWith("advertiser_pages?on_conflict="));
  assert.equal(registrationWrites.length, 1);
  assert.ok(registrationWrites[0].body);
  assert.ok(registrationWrites[0].body[0]);
  assert.equal(registrationWrites[0].body[0].platform, "facebook");
  assert.equal(registrationWrites[0].body[0].page_id, assignmentPageId);
  assert.equal(recordValue(registrationWrites[0].body[0].metadata).source, "customer_meta_assignment");
  assert.equal(registrationWrites[0].body[0].owner_type, "unknown");
  assert.equal(registrationWrites[0].body[0].status, "resolved_collectable");
  const firstTarget = researchWrites.find((write) => write.path.startsWith("ad_radar_customer_interests?on_conflict="));
  assert.ok(firstTarget?.body);
  assert.ok(firstTarget.body[0]);
  assert.equal(firstTarget.body[0].advertiser_page_id, registeredPageId);
  assert.equal(firstTarget.body[0].postcode, "6160");

  kitPostcode = "6150";
  await syncCustomerAdRadarInterests({ researchRest, fetchImpl, env, now: "2026-09-08T02:00:00.000Z" });
  assert.equal(researchWrites.filter((write) => write.path.startsWith("advertiser_pages?on_conflict=")).length, 1);
  const targetWrites = researchWrites.filter((write) => write.path.startsWith("ad_radar_customer_interests?on_conflict="));
  assert.equal(targetWrites.length, 2);
  assert.ok(targetWrites[1].body);
  assert.ok(targetWrites[1].body[0]);
  assert.equal(targetWrites[1].body[0].postcode, "6150");
});

test("sync supports multiple owner workspaces for one profile", () => {
  const secondWorkspaceId = "66666666-6666-4666-8666-666666666666";
  const rows = buildCustomerInterestRows({
    sources: [{ profile_id: "multi-owner", postcode: "6000", source: "signup", active: true }],
    owners: [
      { profile_id: "multi-owner", workspace_id: workspaceId, role: "owner" },
      { profile_id: "multi-owner", workspace_id: secondWorkspaceId, role: "owner" },
    ],
    brandKits: [],
    customerKeySecret: "0123456789abcdef0123456789abcdef",
    now: "2026-09-08T00:00:00.000Z",
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.postcode), ["6000", "6000"]);
  assert.notEqual(rows[0].customer_key, rows[1].customer_key);
});

test("sync never writes research data for incomplete product snapshots", async () => {
  const env = {
    HERMES_CUSTOMER_SUPABASE_URL: "https://customer.example",
    HERMES_CUSTOMER_SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    HERMES_AD_RADAR_CUSTOMER_KEY_SECRET: "0123456789abcdef0123456789abcdef",
    HERMES_CUSTOMER_FRESHNESS_TIMEOUT_MS: "1000",
  };
  for (const failure of ["bad-json-shape", "timeout", "http-error"]) {
    let researchWrites = 0;
    const fetchImpl: CustomerFetch = async (url, init: CustomerRestInit = {}) => {
      const relation = new URL(url).pathname.split("/").at(-1);
      if (relation === "ad_radar_customer_interest_sources") {
        if (failure === "bad-json-shape") return responseJson({ rows: [] });
        if (failure === "timeout") return new Promise((resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("simulated timeout")), { once: true }));
        return responseJson({ error: "unavailable" }, 503);
      }
      return responseJson([]);
    };
    const researchRest: ResearchRest = async (_schema, _path, init: CustomerRestInit = {}) => {
      if (init.method) researchWrites += 1;
      throw new Error("research should not be called");
    };
    await assert.rejects(
      () => syncCustomerAdRadarInterests({ researchRest, fetchImpl, env }),
      failure === "http-error" ? /HTTP 503/iu : /snapshot|timeout/iu,
    );
    assert.equal(researchWrites, 0, failure);
  }
});
