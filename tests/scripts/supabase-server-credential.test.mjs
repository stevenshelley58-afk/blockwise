import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createSupabaseServerClient,
  createSupabaseServerFetch,
  resolveSupabaseServerCredential,
} from "../../scripts/lib/supabase-server-credential.mjs";

const legacyJwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature";
const liveScripts = [
  "scripts/e2e/seed-adstudio-e2e.mjs",
  "scripts/record-meta-app-review.mjs",
  "scripts/research/reconcile-exa-wa-roster-sources.mjs",
  "scripts/research/seed-exa-wa-roster-sources.mjs",
  "scripts/research/sync-demirs-wa-licence-register.mjs",
  "scripts/seed-test-users.mjs",
];

test("script resolver prefers a trimmed secret and retains legacy/missing behavior", () => {
  assert.deepEqual(resolveSupabaseServerCredential({
    SUPABASE_SECRET_KEY: "\uFEFF sb_secret_script ",
    SUPABASE_SERVICE_ROLE_KEY: legacyJwt,
  }), {
    value: "sb_secret_script",
    kind: "secret",
    source: "SUPABASE_SECRET_KEY",
  });
  assert.equal(resolveSupabaseServerCredential({ SUPABASE_SERVICE_ROLE_KEY: legacyJwt })?.kind, "legacy_jwt");
  assert.equal(resolveSupabaseServerCredential({ SUPABASE_SECRET_KEY: legacyJwt })?.kind, "legacy_jwt");
  assert.equal(resolveSupabaseServerCredential({ SUPABASE_SERVICE_ROLE_KEY: "sb_secret_legacy_slot" })?.kind, "secret");
  assert.equal(resolveSupabaseServerCredential({}), null);
});

test("script transport never places an opaque key in Authorization or the URL and preserves unrelated auth", async () => {
  const credential = resolveSupabaseServerCredential({ SUPABASE_SECRET_KEY: "sb_secret_script" });
  const captured = [];
  const fetchImpl = createSupabaseServerFetch(credential, async (input, init) => {
    captured.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response(null, { status: 204 });
  });

  await fetchImpl("https://project.supabase.co/rest/v1/workspaces", {
    headers: { Authorization: "Bearer sb_secret_script" },
  });
  await fetchImpl("https://project.supabase.co/auth/v1/user", {
    headers: { Authorization: "Bearer unrelated-user-jwt" },
  });

  assert.equal(captured[0].headers.get("apikey"), "sb_secret_script");
  assert.equal(captured[0].headers.has("Authorization"), false);
  assert.equal(captured[1].headers.get("Authorization"), "Bearer unrelated-user-jwt");
  assert.doesNotMatch(captured[0].url, /sb_secret_script/);
});

test("script legacy transport adds its bearer without replacing unrelated authorization", async () => {
  const credential = resolveSupabaseServerCredential({ SUPABASE_SERVICE_ROLE_KEY: legacyJwt });
  const captured = [];
  const fetchImpl = createSupabaseServerFetch(credential, async (_input, init) => {
    captured.push(new Headers(init?.headers));
    return new Response(null, { status: 204 });
  });

  await fetchImpl("https://project.supabase.co/rest/v1/workspaces");
  await fetchImpl("https://project.supabase.co/auth/v1/user", {
    headers: { Authorization: "Bearer unrelated-user-jwt" },
  });

  assert.equal(captured[0].get("apikey"), legacyJwt);
  assert.equal(captured[0].get("Authorization"), `Bearer ${legacyJwt}`);
  assert.equal(captured[1].get("Authorization"), "Bearer unrelated-user-jwt");
});

test("script client helper wraps SDK-style opaque bearer transport end to end", async () => {
  let captured = new Headers();
  const fakeCreateClient = (_url, key, options) => ({
    request: () => options.global.fetch("https://project.supabase.co/rest/v1/workspaces", {
      headers: { Authorization: `Bearer ${key}` },
    }),
  });
  const client = createSupabaseServerClient(fakeCreateClient, "https://project.supabase.co", {
    SUPABASE_SECRET_KEY: "sb_secret_script_client",
  }, {
    global: {
      fetch: async (_input, init) => {
        captured = new Headers(init?.headers);
        return new Response(null, { status: 204 });
      },
    },
  });

  await client.request();

  assert.equal(captured.get("apikey"), "sb_secret_script_client");
  assert.equal(captured.has("Authorization"), false);
});

test("every live elevated script uses the shared secret-first client helper", () => {
  for (const path of liveScripts) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /supabase-server-credential\.mjs/, path);
    assert.match(source, /createSupabaseServerClient/, path);
    assert.doesNotMatch(source, /createClient\([^\n]*(?:serviceRoleKey|serviceKey|serverCredential)/, path);
  }
});

test("the AdStudio e2e seed provisions render credits and an appearance fixture", () => {
  const source = readFileSync("scripts/e2e/seed-adstudio-e2e.mjs", "utf8");
  assert.match(source, /rpc\("grant_workspace_credits"/);
  assert.match(source, /p_workspace_id:\s*ADSTUDIO_E2E_WORKSPACE_ID/);
  assert.match(source, /p_entitlement_type:\s*"operator"/);
  assert.match(source, /p_credits:\s*6/);
  assert.match(source, /adstudio-e2e:credit-grant:\$\{periodStart\.toISOString\(\)\.slice\(0, 7\)\}:v1/);
  assert.match(source, /from\("adstudio_brand_kits"\)/);
  assert.match(source, /source_url: "https:\/\/blockwise\.sale"/);
  assert.match(source, /colours_json:/);
  assert.match(source, /from\("provider_connections"\)\.upsert/);
  assert.match(source, /e2eDryRunOnly:\s*true/);
  assert.match(source, /status:\s*"connected"/);
  assert.match(source, /scopes:\s*\[\]/);
  assert.doesNotMatch(source, /accessToken|refreshToken|encrypted_access_token|encrypted_refresh_token/);
  assert.match(source, /Upsert AdStudio e2e token-free Meta connection/);
  assert.match(source, /ADSTUDIO_E2E_META_CONNECTION_ID/);
});
