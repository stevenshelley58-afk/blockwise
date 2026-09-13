import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CRM_CREDENTIAL_LANE,
  CrmCredentialMissingError,
  clearCrmSiteCredential,
  loadCrmSiteCredential,
  upsertCrmSiteCredential,
} from "../src/lib/crm/credentials.ts";

// A fixed 32-byte key so encryption is deterministic in shape across runs.
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const WORKSPACE_A = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_B = "22222222-2222-4222-8222-222222222222";

type VaultRow = {
  encrypted_credential: string;
  credential_nonce: string;
  credential_last_four: string;
};

/**
 * Minimal stand-in for the service-role client, backed by an in-memory vault
 * that behaves like the three RPCs in 20260913010000_crm_site_credentials.sql:
 * one row per workspace, upsert on repeat.
 */
function fakeVault(initial: Record<string, VaultRow> = {}) {
  const rows = new Map<string, VaultRow>(Object.entries(initial));
  const calls: { name: string; args: Record<string, unknown> }[] = [];

  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      const workspaceId = String(args.p_workspace_id ?? "");

      if (name === "crm_site_credential_get") {
        const row = rows.get(workspaceId);
        return Promise.resolve({ data: row ? [row] : [], error: null });
      }

      if (name === "crm_site_credential_upsert") {
        rows.set(workspaceId, {
          encrypted_credential: String(args.p_encrypted_credential),
          credential_nonce: String(args.p_credential_nonce),
          credential_last_four: String(args.p_credential_last_four),
        });
        return Promise.resolve({ data: null, error: null });
      }

      if (name === "crm_site_credential_clear") {
        rows.delete(workspaceId);
        return Promise.resolve({ data: null, error: null });
      }

      throw new Error(`unexpected rpc ${name}`);
    },
  };

  return { client: client as unknown as SupabaseClient, rows, calls };
}

test("a stored per-site credential round-trips through the vault", async () => {
  const vault = fakeVault();

  await upsertCrmSiteCredential({
    serviceSupabase: vault.client,
    workspaceId: WORKSPACE_A,
    apiKey: "key-a-1234",
    apiSecret: "secret-a-abcd",
  });

  const loaded = await loadCrmSiteCredential(vault.client, WORKSPACE_A);
  assert.deepEqual(loaded, { apiKey: "key-a-1234", apiSecret: "secret-a-abcd" });
});

test("the plaintext secret never reaches the vault", async () => {
  const vault = fakeVault();

  await upsertCrmSiteCredential({
    serviceSupabase: vault.client,
    workspaceId: WORKSPACE_A,
    apiKey: "key-a-1234",
    apiSecret: "secret-a-abcd",
  });

  const stored = vault.rows.get(WORKSPACE_A);
  assert.ok(stored, "a row was written");
  assert.doesNotMatch(stored.encrypted_credential, /secret-a-abcd/);
  assert.doesNotMatch(stored.encrypted_credential, /key-a-1234/);

  const upsertCall = vault.calls.find((call) => call.name === "crm_site_credential_upsert");
  assert.equal(upsertCall?.args.p_credential_last_four, "abcd");
});

test("two workspaces never share a credential or a vault row", async () => {
  const vault = fakeVault();

  await upsertCrmSiteCredential({
    serviceSupabase: vault.client,
    workspaceId: WORKSPACE_A,
    apiKey: "key-a",
    apiSecret: "secret-a",
  });
  await upsertCrmSiteCredential({
    serviceSupabase: vault.client,
    workspaceId: WORKSPACE_B,
    apiKey: "key-b",
    apiSecret: "secret-b",
  });

  const a = vault.rows.get(WORKSPACE_A);
  const b = vault.rows.get(WORKSPACE_B);
  assert.ok(a && b);
  assert.notEqual(a.encrypted_credential, b.encrypted_credential);

  assert.deepEqual(await loadCrmSiteCredential(vault.client, WORKSPACE_A), {
    apiKey: "key-a",
    apiSecret: "secret-a",
  });
  assert.deepEqual(await loadCrmSiteCredential(vault.client, WORKSPACE_B), {
    apiKey: "key-b",
    apiSecret: "secret-b",
  });
});

test("a workspace with no credential returns null rather than a shared fallback", async () => {
  const vault = fakeVault();
  assert.equal(await loadCrmSiteCredential(vault.client, WORKSPACE_A), null);
});

test("re-running provisioning overwrites the same row instead of adding one", async () => {
  const vault = fakeVault();

  await upsertCrmSiteCredential({
    serviceSupabase: vault.client,
    workspaceId: WORKSPACE_A,
    apiKey: "key-old",
    apiSecret: "secret-old",
  });
  await upsertCrmSiteCredential({
    serviceSupabase: vault.client,
    workspaceId: WORKSPACE_A,
    apiKey: "key-new",
    apiSecret: "secret-new",
  });

  assert.equal(vault.rows.size, 1);
  assert.deepEqual(await loadCrmSiteCredential(vault.client, WORKSPACE_A), {
    apiKey: "key-new",
    apiSecret: "secret-new",
  });
});

test("a corrupt vault payload is reported as missing, not as an empty credential", async () => {
  const vault = fakeVault({
    [WORKSPACE_A]: {
      encrypted_credential: "\\x" + Buffer.from("not json at all", "utf8").toString("hex"),
      credential_nonce: Buffer.alloc(12, 1).toString("base64"),
      credential_last_four: "zzzz",
    },
  });

  await assert.rejects(
    () => loadCrmSiteCredential(vault.client, WORKSPACE_A),
    CrmCredentialMissingError,
  );
});

test("clearing a credential removes it without touching other workspaces", async () => {
  const vault = fakeVault();

  await upsertCrmSiteCredential({
    serviceSupabase: vault.client,
    workspaceId: WORKSPACE_A,
    apiKey: "key-a",
    apiSecret: "secret-a",
  });
  await upsertCrmSiteCredential({
    serviceSupabase: vault.client,
    workspaceId: WORKSPACE_B,
    apiKey: "key-b",
    apiSecret: "secret-b",
  });

  await clearCrmSiteCredential(vault.client, WORKSPACE_A);

  assert.equal(await loadCrmSiteCredential(vault.client, WORKSPACE_A), null);
  assert.deepEqual(await loadCrmSiteCredential(vault.client, WORKSPACE_B), {
    apiKey: "key-b",
    apiSecret: "secret-b",
  });
});

test("the vault lane name is stable and workspace-scoped", () => {
  assert.equal(CRM_CREDENTIAL_LANE, "blockwise_crm_site");
});
