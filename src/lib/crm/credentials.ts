/**
 * Per-site CRM credentials.
 *
 * The Frappe API key/secret for a customer site is NOT a deployment-wide
 * secret. One workspace's credential must not open another workspace's site, so
 * each site gets its own pair.
 *
 * The pair is stored as one row per workspace in the existing encrypted vault
 * (`private.provider_token_vault`, lane `runtime_provider = 'blockwise_crm_site'`)
 * and reached only through the service-role RPCs added in
 * `20260913010000_crm_site_credentials.sql`. The vault encrypts with
 * `TOKEN_ENCRYPTION_KEY` through the same `token-crypto.ts` helpers the provider
 * OAuth lane uses, so there is exactly one encryption mechanism in the product.
 *
 * The plaintext is a small JSON object `{key, secret}` so the pair is written
 * and read as a unit; a half-written credential is not representable.
 *
 * Server-only. Nothing here may be imported from a client component.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  decryptToken,
  encryptToken,
  postgresByteaToTokenCiphertext,
  tokenCiphertextToPostgresBytea,
} from "../providers/token-crypto.ts";

/** Vault lane name for the workspace-scoped CRM site credential. */
export const CRM_CREDENTIAL_LANE = "blockwise_crm_site";

export type CrmSiteCredential = {
  apiKey: string;
  apiSecret: string;
};

/** Wire shape of the encrypted vault payload. Kept short; never logged. */
type CredentialPayload = {
  key: string;
  secret: string;
};

type CredentialRow = {
  encrypted_credential: string | Uint8Array | ArrayBuffer | null;
  credential_nonce: string | null;
  credential_last_four: string | null;
};

/**
 * Raised when a site is mapped but has no usable credential. This is an
 * operational state ("setup did not finish"), not a customer error, and it must
 * never be silently downgraded to "no leads".
 */
export class CrmCredentialMissingError extends Error {
  readonly workspaceId: string;

  constructor(workspaceId: string) {
    super(`Workspace ${workspaceId} has no CRM site credential.`);
    this.name = "CrmCredentialMissingError";
    this.workspaceId = workspaceId;
  }
}

/**
 * Read the credential for a workspace. Returns null when the workspace has no
 * stored credential, so the caller decides whether that is "not provisioned"
 * or "legacy shared credential" rather than guessing here.
 */
export async function loadCrmSiteCredential(
  serviceSupabase: SupabaseClient,
  workspaceId: string,
): Promise<CrmSiteCredential | null> {
  const { data, error } = await serviceSupabase.rpc("crm_site_credential_get", {
    p_workspace_id: workspaceId,
  });

  if (error) {
    // Surface the failure: treating it as "no credential" would silently
    // degrade every CRM read for this workspace.
    throw new Error(`crm_site_credential_get failed: ${error.message}`);
  }

  const row = (Array.isArray(data) ? (data[0] ?? null) : data) as CredentialRow | null;
  if (!row?.credential_nonce) return null;

  const ciphertext = postgresByteaToTokenCiphertext(row.encrypted_credential);
  if (!ciphertext) return null;

  // A failed decrypt (wrong key, truncated row, rotated key material) means the
  // stored credential is unusable. Report it as missing so the surface can say
  // setup is incomplete, instead of surfacing a raw crypto error.
  let plaintext: string;
  try {
    plaintext = decryptToken({ ciphertext, nonce: row.credential_nonce, lastFour: "" });
  } catch {
    throw new CrmCredentialMissingError(workspaceId);
  }

  return parseCredential(plaintext, workspaceId);
}

/**
 * Store the credential for a workspace. Provisioning and rotation both call
 * this; it upserts on the workspace so a retry can never add a second row.
 *
 * Returns the secret's last four characters so the caller can record the
 * non-secret reference on the mapping row without re-reading the secret.
 */
export async function upsertCrmSiteCredential(input: {
  serviceSupabase: SupabaseClient;
  workspaceId: string;
  apiKey: string;
  apiSecret: string;
}): Promise<{ lastFour: string }> {
  const apiKey = input.apiKey.trim();
  const apiSecret = input.apiSecret.trim();
  if (!apiKey || !apiSecret) {
    throw new Error("A CRM site credential requires both an API key and an API secret.");
  }

  const payload: CredentialPayload = { key: apiKey, secret: apiSecret };
  const encrypted = encryptToken(JSON.stringify(payload));

  const { error } = await input.serviceSupabase.rpc("crm_site_credential_upsert", {
    p_workspace_id: input.workspaceId,
    p_encrypted_credential: tokenCiphertextToPostgresBytea(encrypted.ciphertext),
    p_credential_nonce: encrypted.nonce,
    p_credential_last_four: apiSecret.slice(-4),
  });

  if (error) throw new Error(`crm_site_credential_upsert failed: ${error.message}`);
  return { lastFour: apiSecret.slice(-4) };
}

/**
 * Clear the credential for a workspace. Used when a workspace is retired. It
 * never deletes CRM records; it only removes Blockwise's ability to call the
 * site.
 */
export async function clearCrmSiteCredential(
  serviceSupabase: SupabaseClient,
  workspaceId: string,
): Promise<void> {
  const { error } = await serviceSupabase.rpc("crm_site_credential_clear", {
    p_workspace_id: workspaceId,
  });
  if (error) throw new Error(`crm_site_credential_clear failed: ${error.message}`);
}

function parseCredential(plaintext: string, workspaceId: string): CrmSiteCredential {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new CrmCredentialMissingError(workspaceId);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as CredentialPayload).key !== "string" ||
    typeof (parsed as CredentialPayload).secret !== "string"
  ) {
    throw new CrmCredentialMissingError(workspaceId);
  }

  const { key, secret } = parsed as CredentialPayload;
  if (!key || !secret) {
    throw new CrmCredentialMissingError(workspaceId);
  }

  return { apiKey: key, apiSecret: secret };
}
