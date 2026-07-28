import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  hermesSupabaseHeaders,
  resolveHermesCustomerSupabaseCredential,
  resolveHermesSupabaseCredential,
} from "../../hermes/tools/research-runtime/bin/supabase-credentials.mjs";

const legacyJwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature";

test("Hermes resolves the secret aliases before legacy service-role aliases", () => {
  const credential = resolveHermesSupabaseCredential({
    HERMES_SUPABASE_SECRET_KEY: "\uFEFF sb_secret_hermes ",
    SUPABASE_SECRET_KEY: "sb_secret_global",
    HERMES_SUPABASE_SERVICE_ROLE_KEY: legacyJwt,
  });

  assert.deepEqual(credential, {
    value: "sb_secret_hermes",
    kind: "secret",
    source: "HERMES_SUPABASE_SECRET_KEY",
  });
  assert.equal(resolveHermesSupabaseCredential({ HERMES_SUPABASE_SECRET_KEY: legacyJwt })?.kind, "legacy_jwt");
  assert.equal(resolveHermesSupabaseCredential({ HERMES_SUPABASE_SERVICE_ROLE_KEY: "sb_secret_legacy_slot" })?.kind, "secret");
  assert.equal(resolveHermesSupabaseCredential({}), null);
});

test("Hermes keeps the private research credential ahead of global customer aliases", () => {
  const credential = resolveHermesSupabaseCredential({
    HERMES_SUPABASE_SERVICE_ROLE_KEY: legacyJwt,
    SUPABASE_SECRET_KEY: "sb_secret_customer",
  });

  assert.equal(credential?.source, "HERMES_SUPABASE_SERVICE_ROLE_KEY");
  assert.equal(credential?.value, legacyJwt);
  assert.equal(
    resolveHermesCustomerSupabaseCredential({
      HERMES_CUSTOMER_SUPABASE_SECRET_KEY: "sb_secret_customer",
      HERMES_SUPABASE_SERVICE_ROLE_KEY: legacyJwt,
    })?.source,
    "HERMES_CUSTOMER_SUPABASE_SECRET_KEY",
  );
});

test("Hermes REST and Storage headers never use an opaque key as bearer", () => {
  const opaque = resolveHermesSupabaseCredential({ SUPABASE_SECRET_KEY: "sb_secret_hermes" });
  const exactBearer = hermesSupabaseHeaders(opaque, {
    Authorization: "Bearer sb_secret_hermes",
    "Content-Type": "application/json",
  });
  const unrelatedBearer = hermesSupabaseHeaders(opaque, {
    Authorization: "Bearer user-session-jwt",
  });

  assert.equal(exactBearer.apikey, "sb_secret_hermes");
  assert.equal("authorization" in exactBearer, false);
  assert.equal(unrelatedBearer.authorization, "Bearer user-session-jwt");
});

test("Hermes legacy JWT headers preserve the existing apikey plus bearer behavior", () => {
  const credential = resolveHermesSupabaseCredential({ SUPABASE_SERVICE_ROLE_KEY: legacyJwt });
  const headers = hermesSupabaseHeaders(credential);

  assert.equal(headers.apikey, legacyJwt);
  assert.equal(headers.authorization, `Bearer ${legacyJwt}`);
});

test("Hermes supervisor separates private research and customer storage credentials", () => {
  const source = readFileSync(
    "hermes/tools/research-runtime/bin/supabase-supervisor.mjs",
    "utf8",
  );

  assert.equal((source.match(/hermesSupabaseHeaders\(supabaseCredential/g) ?? []).length, 1);
  assert.equal((source.match(/hermesSupabaseHeaders\(customerSupabaseCredential/g) ?? []).length, 2);
  assert.doesNotMatch(source, /Authorization:\s*`Bearer \$\{serviceRoleKey\}`/);
  assert.doesNotMatch(source, /const serviceRoleKey/);
});
