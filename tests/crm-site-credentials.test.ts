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
 * The non-secret mirror on `public.crm_workspace_sites`. Both
 * `crm_site_credential_upsert` and `crm_site_credential_clear` update it in the
 * same transaction as the vault write, so the fake has to model it. Without it
 * the tests cannot notice the mapping row going stale, which is the defect this
 * pairing exists to prevent.
 */
type MappingRow = {
  credential_version: number;
  credential_last_four: string | null;
  credential_rotated_at: string | null;
};

/**
 * Minimal stand-in for the service-role client, backed by an in-memory vault
 * that behaves like the three RPCs in 20260913010000_crm_site_credentials.sql:
 * one row per workspace, upsert on repeat.
 *
 * `mappedWorkspaces` are the workspaces that already have a `crm_workspace_sites`
 * row. A workspace that is not listed has no CRM site, so the real functions
 * match zero mapping rows and store only in the vault.
 */
function fakeVault(initial: Record<string, VaultRow> = {}, mappedWorkspaces: string[] = []) {
  const rows = new Map<string, VaultRow>(Object.entries(initial));
  const mapping = new Map<string, MappingRow>(
    mappedWorkspaces.map((workspaceId) => [
      workspaceId,
      { credential_version: 0, credential_last_four: null, credential_rotated_at: null },
    ]),
  );
  const calls: { name: string; args: Record<string, unknown> }[] = [];

  // Mirrors the `update public.crm_workspace_sites ... where workspace_id = ...`
  // in both functions. Matching no row is a no-op, exactly as in SQL.
  const writeMapping = (
    workspaceId: string,
    lastFour: string | null,
    nextVersion: (current: number) => number,
  ) => {
    const row = mapping.get(workspaceId);
    if (!row) return;
    row.credential_version = nextVersion(row.credential_version);
    row.credential_last_four = lastFour;
    row.credential_rotated_at = "2026-09-13T00:00:00.000Z";
  };

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
        writeMapping(workspaceId, String(args.p_credential_last_four), (current) => current + 1);
        return Promise.resolve({ data: null, error: null });
      }

      if (name === "crm_site_credential_clear") {
        // The real function blanks the credential columns and keeps the row, so
        // the provisioning lifecycle stays auditable. Mirror that rather than a
        // delete, or this fake would hide a divergence from production.
        if (rows.has(workspaceId)) {
          rows.set(workspaceId, {
            encrypted_credential: "",
            credential_nonce: "",
            credential_last_four: "",
          });
        }
        writeMapping(workspaceId, null, () => 0);
        return Promise.resolve({ data: null, error: null });
      }

      throw new Error(`unexpected rpc ${name}`);
    },
  };

  return { client: client as unknown as SupabaseClient, rows, mapping, calls };
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
});

test("the recorded reference is the api key's last four, not the secret's", async () => {
  const vault = fakeVault();

  await upsertCrmSiteCredential({
    serviceSupabase: vault.client,
    workspaceId: WORKSPACE_A,
    apiKey: "key-a-1234",
    apiSecret: "secret-a-abcd",
  });

  // provision-api-user.py reports credential_last_four = api_key[-4:], and that
  // is the number an operator sees while provisioning. The vault has to record
  // the same number or "which credential is live" cannot be answered by
  // comparing the two.
  const upsertCall = vault.calls.find((call) => call.name === "crm_site_credential_upsert");
  assert.equal(upsertCall?.args.p_credential_last_four, "1234");

  const stored = vault.rows.get(WORKSPACE_A);
  assert.notEqual(stored?.credential_last_four, "abcd", "the secret must not be partly echoed");
});

test("an explicit reference from the provisioning output is kept as given", async () => {
  const vault = fakeVault();

  const result = await upsertCrmSiteCredential({
    serviceSupabase: vault.client,
    workspaceId: WORKSPACE_A,
    apiKey: "key-a-1234",
    apiSecret: "secret-a-abcd",
    lastFour: "94a4",
  });

  assert.equal(result.lastFour, "94a4");
  assert.equal(vault.rows.get(WORKSPACE_A)?.credential_last_four, "94a4");
});

test("a blank explicit reference falls back to the api key's last four", async () => {
  const vault = fakeVault();

  const result = await upsertCrmSiteCredential({
    serviceSupabase: vault.client,
    workspaceId: WORKSPACE_A,
    apiKey: "key-a-1234",
    apiSecret: "secret-a-abcd",
    lastFour: "   ",
  });

  assert.equal(result.lastFour, "1234");
});

test("a credential missing either half is refused before any write", async () => {
  const vault = fakeVault();

  await assert.rejects(
    () =>
      upsertCrmSiteCredential({
        serviceSupabase: vault.client,
        workspaceId: WORKSPACE_A,
        apiKey: "key-a",
        apiSecret: "   ",
      }),
    /both an API key and an API secret/,
  );
  assert.equal(vault.rows.size, 0);
  assert.equal(vault.calls.length, 0, "nothing reached the vault");
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

test("clearing a credential blanks it without touching other workspaces", async () => {
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
  // The row survives, blanked. crm_site_credential_clear updates rather than
  // deletes, and the rehearsal against a production copy confirms it: the
  // credential reads as absent while the row stays for audit.
  assert.equal(vault.rows.size, 2, "the cleared row is kept");
  assert.equal(vault.rows.get(WORKSPACE_A)?.credential_nonce, "");
  assert.deepEqual(await loadCrmSiteCredential(vault.client, WORKSPACE_B), {
    apiKey: "key-b",
    apiSecret: "secret-b",
  });
});

test("the vault lane name is stable and workspace-scoped", () => {
  assert.equal(CRM_CREDENTIAL_LANE, "blockwise_crm_site");
});

test("storing a credential moves the mapping row off the legacy state", async () => {
  const vault = fakeVault({}, [WORKSPACE_A]);

  await upsertCrmSiteCredential({
    serviceSupabase: vault.client,
    workspaceId: WORKSPACE_A,
    apiKey: "key-a-1234",
    apiSecret: "secret-a-abcd",
  });

  // credential_version 0 is defined as "no per-site credential has been stored
  // yet", which is the legacy shared-credential state. A store that leaves it at
  // 0 makes the row describe the wrong thing, so the store has to move it.
  const row = vault.mapping.get(WORKSPACE_A);
  assert.equal(row?.credential_version, 1);
  assert.equal(row?.credential_last_four, "1234");
  assert.ok(row?.credential_rotated_at, "the change is timestamped");
});

test("a rotation increments the version instead of pinning it at one", async () => {
  const vault = fakeVault({}, [WORKSPACE_A]);

  await upsertCrmSiteCredential({
    serviceSupabase: vault.client,
    workspaceId: WORKSPACE_A,
    apiKey: "key-old-1111",
    apiSecret: "secret-old",
  });
  await upsertCrmSiteCredential({
    serviceSupabase: vault.client,
    workspaceId: WORKSPACE_A,
    apiKey: "key-new-2222",
    apiSecret: "secret-new",
  });

  assert.equal(vault.mapping.get(WORKSPACE_A)?.credential_version, 2);
  assert.equal(vault.mapping.get(WORKSPACE_A)?.credential_last_four, "2222");
});

test("clearing resets the mapping row so a retired site does not look credentialed", async () => {
  const vault = fakeVault({}, [WORKSPACE_A]);

  await upsertCrmSiteCredential({
    serviceSupabase: vault.client,
    workspaceId: WORKSPACE_A,
    apiKey: "key-a-1234",
    apiSecret: "secret-a-abcd",
  });
  await clearCrmSiteCredential(vault.client, WORKSPACE_A);

  const row = vault.mapping.get(WORKSPACE_A);
  assert.equal(row?.credential_version, 0);
  assert.equal(row?.credential_last_four, null);
  assert.ok(row?.credential_rotated_at, "removal is timestamped too");
});

test("a store touches only its own mapping row", async () => {
  const vault = fakeVault({}, [WORKSPACE_A, WORKSPACE_B]);

  await upsertCrmSiteCredential({
    serviceSupabase: vault.client,
    workspaceId: WORKSPACE_A,
    apiKey: "key-a-1234",
    apiSecret: "secret-a-abcd",
  });

  assert.equal(vault.mapping.get(WORKSPACE_A)?.credential_version, 1);
  assert.equal(vault.mapping.get(WORKSPACE_B)?.credential_version, 0, "untouched");
  assert.equal(vault.mapping.get(WORKSPACE_B)?.credential_last_four, null);
});

test("a workspace with no mapping row still stores, and no row is invented", async () => {
  // demo.crm.internal is bound to a workspace with no crm_workspace_sites row.
  // Storing its credential must work: the vault is the authority, and the
  // mapping row only mirrors it. Inventing a mapping row here would create a CRM
  // site record that nothing provisioned.
  const vault = fakeVault();

  await upsertCrmSiteCredential({
    serviceSupabase: vault.client,
    workspaceId: WORKSPACE_A,
    apiKey: "key-a-1234",
    apiSecret: "secret-a-abcd",
  });

  assert.deepEqual(await loadCrmSiteCredential(vault.client, WORKSPACE_A), {
    apiKey: "key-a-1234",
    apiSecret: "secret-a-abcd",
  });
  assert.equal(vault.mapping.size, 0, "no mapping row was created");
});
