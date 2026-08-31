import assert from "node:assert/strict";
import test from "node:test";
import { createHash, createHmac } from "node:crypto";

import {
  buildInternalSigningPayload,
  hashInternalBody,
  INTERNAL_AUTH_MAX_CLOCK_SKEW_SECONDS,
  verifyInternalRequest,
} from "../src/lib/internal-auth.ts";

const SECRET = "test-internal-secret-0123456789abcdef";

type AuditRow = { action: string; metadata: Record<string, unknown> };

/**
 * Mock service client covering the three calls verifyInternalRequest makes:
 * expired-nonce delete, nonce insert (ON CONFLICT DO NOTHING RETURNING), and
 * the audit_logs insert.
 */
function makeSupabase(opts: { existingNonces?: Set<string>; onInsert?: (nonce: string) => void } = {}) {
  const audits: AuditRow[] = [];
  const seen: Set<string> = opts.existingNonces ?? new Set();
  const client = {
    from(table: string) {
      if (table === "internal_request_nonces") {
        return {
          delete: () => ({
            lt: () => Promise.resolve({ error: null }),
          }),
          insert: (row: { nonce: string }, insertOpts?: { ignoreDuplicates?: boolean }) => ({
            select: () => {
              if (!insertOpts?.ignoreDuplicates) return Promise.reject(new Error("expected ignoreDuplicates insert"));
              if (seen.has(row.nonce)) return Promise.resolve({ data: [], error: null });
              seen.add(row.nonce);
              opts.onInsert?.(row.nonce);
              return Promise.resolve({ data: [{ nonce: row.nonce }], error: null });
            },
          }),
        };
      }
      if (table === "audit_logs") {
        return {
          insert: (row: Record<string, unknown>) => {
            audits.push({ action: String(row.action), metadata: (row.metadata ?? {}) as Record<string, unknown> });
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client, audits, seen };
}

function sign(
  parts: Parameters<typeof buildInternalSigningPayload>[0],
  secret = SECRET,
): string {
  return createHmac("sha256", secret).update(buildInternalSigningPayload(parts)).digest("hex");
}

function makeRequest(
  url: string,
  headers: Record<string, string>,
  method = "GET",
  body = "",
): Request {
  return new Request(url, { method, headers, body: method === "GET" ? undefined : body });
}

function validHeaders(overrides: Record<string, string> = {}, secret = SECRET) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = overrides["x-blockwise-nonce"] ?? crypto.randomUUID();
  const scope = overrides["x-blockwise-scope"] ?? "adstudio.publish";
  const method = overrides["x-blockwise-method"] ?? "GET";
  const path = overrides["x-blockwise-path"] ?? "/api/internal/adstudio/publish/state?adId=a&workspaceId=w";
  const body = overrides["x-blockwise-body"] ?? "";
  const signature = sign({ timestamp, nonce, scope, method, path, bodyHash: hashInternalBody(body) }, secret);
  return {
    "x-blockwise-timestamp": timestamp,
    "x-blockwise-nonce": nonce,
    "x-blockwise-scope": scope,
    "x-blockwise-signature": signature,
  };
}

test("valid signed GET request is accepted and audited", async () => {
  const { client, audits } = makeSupabase();
  const url = "https://blockwise.sale/api/internal/adstudio/publish/state?adId=a&workspaceId=w";
  const result = await verifyInternalRequest(makeRequest(url, validHeaders()), "adstudio.publish", {
    secret: SECRET,
    supabase: client as never,
  });

  assert.equal(result.ok, true);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "internal.api.request");
  assert.equal(audits[0].metadata.scope, "adstudio.publish");
});

test("valid signed POST request with body is accepted", async () => {
  const { client } = makeSupabase();
  const body = JSON.stringify({ adId: "a", workspaceId: "w" });
  const headers = validHeaders({
    "x-blockwise-method": "POST",
    "x-blockwise-path": "/api/internal/adstudio/publish/freeze",
    "x-blockwise-body": body,
  });
  const result = await verifyInternalRequest(
    makeRequest("https://blockwise.sale/api/internal/adstudio/publish/freeze", headers, "POST", body),
    "adstudio.publish",
    { secret: SECRET, supabase: client as never, body },
  );

  assert.equal(result.ok, true);
});

test("missing secret fails closed with 503", async () => {
  const { client } = makeSupabase();
  const result = await verifyInternalRequest(
    makeRequest("https://x.test/api/internal/adstudio/publish/state", {}),
    "adstudio.publish",
    { secret: "", supabase: client as never },
  );

  assert.deepEqual(result, { ok: false, status: 503, error: "internal_auth_not_configured" });
});

test("tampered signature is rejected", async () => {
  const { client } = makeSupabase();
  const headers = validHeaders();
  headers["x-blockwise-signature"] = "0".repeat(64);
  const result = await verifyInternalRequest(
    makeRequest("https://blockwise.sale/api/internal/adstudio/publish/state?adId=a&workspaceId=w", headers),
    "adstudio.publish",
    { secret: SECRET, supabase: client as never },
  );

  assert.deepEqual(result, { ok: false, status: 401, error: "invalid_signature" });
});

test("signature signed with the wrong secret is rejected", async () => {
  const { client } = makeSupabase();
  const headers = validHeaders({}, "another-secret-entirely-0123456789");
  const result = await verifyInternalRequest(
    makeRequest("https://blockwise.sale/api/internal/adstudio/publish/state?adId=a&workspaceId=w", headers),
    "adstudio.publish",
    { secret: SECRET, supabase: client as never },
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 401);
});

test("stale timestamp beyond the skew window is rejected", async () => {
  const { client } = makeSupabase();
  const staleSeconds = Math.floor(Date.now() / 1000) - INTERNAL_AUTH_MAX_CLOCK_SKEW_SECONDS - 5;
  const nonce = crypto.randomUUID();
  const path = "/api/internal/adstudio/publish/state?adId=a&workspaceId=w";
  const signature = sign({ timestamp: String(staleSeconds), nonce, scope: "adstudio.publish", method: "GET", path, bodyHash: hashInternalBody("") });
  const result = await verifyInternalRequest(
    makeRequest(`https://blockwise.sale${path}`, {
      "x-blockwise-timestamp": String(staleSeconds),
      "x-blockwise-nonce": nonce,
      "x-blockwise-scope": "adstudio.publish",
      "x-blockwise-signature": signature,
    }),
    "adstudio.publish",
    { secret: SECRET, supabase: client as never },
  );

  assert.deepEqual(result, { ok: false, status: 401, error: "stale_timestamp" });
});

test("wrong scope claim is rejected with 403", async () => {
  const { client } = makeSupabase();
  const headers = validHeaders({ "x-blockwise-scope": "adstudio.templates" });
  const result = await verifyInternalRequest(
    makeRequest("https://blockwise.sale/api/internal/adstudio/publish/state?adId=a&workspaceId=w", headers),
    "adstudio.publish",
    { secret: SECRET, supabase: client as never },
  );

  assert.deepEqual(result, { ok: false, status: 403, error: "scope_mismatch" });
});

test("replayed nonce is rejected", async () => {
  const nonce = crypto.randomUUID();
  const { client } = makeSupabase({ existingNonces: new Set([nonce]) });
  const headers = validHeaders({ "x-blockwise-nonce": nonce });
  const result = await verifyInternalRequest(
    makeRequest("https://blockwise.sale/api/internal/adstudio/publish/state?adId=a&workspaceId=w", headers),
    "adstudio.publish",
    { secret: SECRET, supabase: client as never },
  );

  assert.deepEqual(result, { ok: false, status: 401, error: "replayed_nonce" });
});

test("missing auth headers are rejected without touching the nonce store", async () => {
  const { client, seen } = makeSupabase();
  const result = await verifyInternalRequest(
    makeRequest("https://blockwise.sale/api/internal/adstudio/publish/state?adId=a&workspaceId=w", {}),
    "adstudio.publish",
    { secret: SECRET, supabase: client as never },
  );

  assert.deepEqual(result, { ok: false, status: 401, error: "missing_internal_auth_headers" });
  assert.equal(seen.size, 0);
});

test("nonce store failure fails closed with 503", async () => {
  const failing = {
    from() {
      return {
        delete: () => ({
          lt: () => Promise.reject(new Error("db down")),
        }),
      };
    },
  };
  const headers = validHeaders();
  const result = await verifyInternalRequest(
    makeRequest("https://blockwise.sale/api/internal/adstudio/publish/state?adId=a&workspaceId=w", headers),
    "adstudio.publish",
    { secret: SECRET, supabase: failing as never },
  );

  assert.deepEqual(result, { ok: false, status: 503, error: "internal_auth_unavailable" });
});
