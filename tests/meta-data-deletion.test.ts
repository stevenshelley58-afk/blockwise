import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseAndVerifySignedRequest } from "../src/lib/meta/data-deletion.ts";

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function buildSignedRequest(payload: Record<string, unknown>, secret: string) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const encodedSignature = base64UrlEncode(createHmac("sha256", secret).update(encodedPayload).digest());

  return `${encodedSignature}.${encodedPayload}`;
}

test("Meta data deletion signed_request verification accepts valid HMAC-SHA256 payloads", () => {
  const payload = {
    algorithm: "HMAC-SHA256",
    issued_at: 1_779_932_400,
    user_id: "meta_user_123",
  };
  const result = parseAndVerifySignedRequest(buildSignedRequest(payload, "secret"), "secret");

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.user_id, "meta_user_123");
  }
});

test("Meta data deletion signed_request verification rejects tampered signatures", () => {
  const signedRequest = buildSignedRequest({ algorithm: "HMAC-SHA256", user_id: "meta_user_123" }, "secret");
  const result = parseAndVerifySignedRequest(`bad.${signedRequest.split(".")[1]}`, "secret");

  assert.deepEqual(result, { ok: false, error: "signed_request signature is invalid." });
});

test("Meta connection revocation only writes columns that exist on provider_connections", () => {
  const helper = readFileSync("src/lib/meta/data-deletion.ts", "utf8");

  // 202605270001_security_hardening dropped the token columns from
  // public.provider_connections; writing them makes PostgREST reject the
  // whole update and the connection is never marked revoked.
  const connectionUpdates = helper.matchAll(/\.from\("provider_connections"\)\s*\.update\(\{([\s\S]*?)\}\)\s*\.eq\(/g);
  let updateCount = 0;

  for (const match of connectionUpdates) {
    updateCount += 1;
    assert.doesNotMatch(
      match[1],
      /encrypted_access_token|encrypted_refresh_token|token_nonce|token_last_four/,
      "provider_connections update must not write dropped token columns",
    );
  }

  assert.ok(updateCount >= 1, "expected at least one provider_connections update in data-deletion helper");

  // Both revocation writes must surface PostgREST errors instead of silently
  // reporting the deletion as completed.
  assert.match(helper, /vaultError/);
  assert.match(helper, /connectionError/);
});

test("Meta deauthorize callback verifies the signed request and revokes connections", () => {
  const route = readFileSync("src/app/api/integrations/meta/deauthorize/route.ts", "utf8");
  const helper = readFileSync("src/lib/meta/data-deletion.ts", "utf8");

  assert.match(route, /parseAndVerifySignedRequest\(signedRequest, appSecret\)/);
  assert.match(route, /processMetaDeauthorizeRequest\(userId\)/);
  assert.match(helper, /export async function processMetaDeauthorizeRequest/);
  assert.match(helper, /"meta_deauthorize"/);
});

test("Meta data deletion route persists, exposes status lookup, and has a server-side processor", () => {
  const route = readFileSync("src/app/api/integrations/meta/data-deletion/route.ts", "utf8");
  const helper = readFileSync("src/lib/meta/data-deletion.ts", "utf8");
  const page = readFileSync("src/app/(legal)/data-deletion/page.tsx", "utf8");

  assert.match(route, /recordDeletionRequest\(userId, confirmationCode, parsed\.payload\)/);
  assert.match(route, /processMetaDataDeletionRequest\(confirmationCode\)/);
  assert.match(route, /loadDeletionStatus\(confirmationCode\)/);
  assert.match(helper, /\.from\("meta_data_deletion_requests"\)/);
  assert.match(helper, /\.from\("meta_leads"\)/);
  assert.match(helper, /\.schema\("private"\)\s*[\s\S]*?\.from\("provider_token_vault"\)/);
  assert.match(page, /Deletion request status/);
});
