import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createSupabaseServerFetch,
  resolveSupabaseServerCredential,
  supabaseServerCredentialHeaders,
} from "../src/lib/supabase/credentials.ts";
import { createSupabaseServiceClient } from "../src/lib/supabase/service.ts";

const legacyJwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature";

test("secret-only credentials trim BOM/whitespace and win during rotation", () => {
  const credential = resolveSupabaseServerCredential({
    SUPABASE_SECRET_KEY: "\uFEFF  sb_secret_rotated  ",
    SUPABASE_SERVICE_ROLE_KEY: legacyJwt,
  });

  assert.deepEqual(credential, {
    value: "sb_secret_rotated",
    kind: "secret",
    source: "SUPABASE_SECRET_KEY",
  });
});

test("legacy JWT remains a supported fallback and missing credentials return null", () => {
  const credential = resolveSupabaseServerCredential({ SUPABASE_SERVICE_ROLE_KEY: legacyJwt });

  assert.equal(credential?.kind, "legacy_jwt");
  assert.deepEqual(supabaseServerCredentialHeaders(credential!), {
    apikey: legacyJwt,
    Authorization: `Bearer ${legacyJwt}`,
  });
  assert.equal(resolveSupabaseServerCredential({}), null);
});

test("credential kind follows the value even when a JWT is stored in the preferred variable", () => {
  const credential = resolveSupabaseServerCredential({ SUPABASE_SECRET_KEY: legacyJwt });
  const opaqueInLegacyVariable = resolveSupabaseServerCredential({
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_in_legacy_slot",
  });

  assert.equal(credential?.source, "SUPABASE_SECRET_KEY");
  assert.equal(credential?.kind, "legacy_jwt");
  assert.equal(opaqueInLegacyVariable?.source, "SUPABASE_SERVICE_ROLE_KEY");
  assert.equal(opaqueInLegacyVariable?.kind, "secret");
});

test("service client fails closed when neither server credential exists", () => {
  assert.throws(
    () => createSupabaseServiceClient({ env: { NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" } }),
    /Supabase service-role environment is missing/,
  );
});

test("opaque secret transport keeps apikey and strips only its synthesized bearer", async () => {
  const credential = resolveSupabaseServerCredential({ SUPABASE_SECRET_KEY: "sb_secret_test" })!;
  const captured: Headers[] = [];
  const wrapped = createSupabaseServerFetch(credential, async (_input, init) => {
    captured.push(new Headers(init?.headers));
    return new Response(null, { status: 204 });
  });

  await wrapped("https://project.supabase.co/rest/v1/workspaces", {
    headers: { Authorization: "Bearer sb_secret_test" },
  });
  await wrapped("https://project.supabase.co/auth/v1/admin/users", {
    headers: { Authorization: "Bearer unrelated-user-jwt" },
  });
  await wrapped(new Request("https://project.supabase.co/auth/v1/user", {
    headers: { Authorization: "Bearer request-user-jwt" },
  }));

  assert.equal(captured[0].get("apikey"), "sb_secret_test");
  assert.equal(captured[0].has("Authorization"), false);
  assert.equal(captured[1].get("apikey"), "sb_secret_test");
  assert.equal(captured[1].get("Authorization"), "Bearer unrelated-user-jwt");
  assert.equal(captured[2].get("Authorization"), "Bearer request-user-jwt");
});

test("legacy transport preserves exact apikey and bearer headers", async () => {
  const credential = resolveSupabaseServerCredential({ SUPABASE_SERVICE_ROLE_KEY: legacyJwt })!;
  const captured: Headers[] = [];
  const wrapped = createSupabaseServerFetch(credential, async (_input, init) => {
    captured.push(new Headers(init?.headers));
    return new Response(null, { status: 204 });
  });

  await wrapped("https://project.supabase.co/storage/v1/object/bucket/key");
  await wrapped("https://project.supabase.co/auth/v1/user", {
    headers: { Authorization: "Bearer unrelated-user-jwt" },
  });

  assert.equal(captured[0].get("apikey"), legacyJwt);
  assert.equal(captured[0].get("Authorization"), `Bearer ${legacyJwt}`);
  assert.equal(captured[1].get("apikey"), legacyJwt);
  assert.equal(captured[1].get("Authorization"), "Bearer unrelated-user-jwt");
});

test("service client REST, Storage, and Auth admin calls use opaque-safe transport", async () => {
  const requests: Array<{ url: string; headers: Headers }> = [];
  const client = createSupabaseServiceClient({
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_client_test",
    },
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) });
      return Response.json(String(input).includes("/auth/v1/") ? { users: [] } : []);
    },
  });

  await client.from("workspaces").select("id").limit(1);
  await client.storage.from("assets").list();
  await client.auth.admin.listUsers();

  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.equal(request.headers.get("apikey"), "sb_secret_client_test", request.url);
    assert.equal(request.headers.has("Authorization"), false, request.url);
    assert.doesNotMatch(request.url, /sb_secret_client_test/);
  }
});

test("health, tracking, and Trigger runtimes use the central secret-first resolver", () => {
  for (const path of ["src/app/api/health/route.ts", "src/app/api/track/route.ts"]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /resolveSupabaseServerCredential/, path);
    assert.doesNotMatch(source, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/, path);
  }

  for (const path of [
    "trigger/ad-radar-accuracy.ts",
    "trigger/adstudio-generate.ts",
    "trigger/meta-publish.ts",
    "trigger/provider-sync.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /\.\.\/src\/lib\/supabase\/service\.ts/, path);
    assert.doesNotMatch(source, /process\.env\.SUPABASE_(?:SECRET_KEY|SERVICE_ROLE_KEY)/, path);
  }
});
