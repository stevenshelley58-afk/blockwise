import type { createSupabaseServerClient } from "../supabase/server.ts";
import type { createSupabaseServiceClient } from "../supabase/service.ts";

import type { MonitorProvider, MonitorProviderStatus } from "../monitor/dashboard-data.ts";
import {
  decryptToken,
  encryptToken,
  postgresByteaToTokenCiphertext,
  type EncryptedToken,
} from "./token-crypto.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type ProviderConnectionMetadata = {
  id: string;
  workspaceId: string;
  provider: MonitorProvider;
  status: MonitorProviderStatus;
  scopes: string[];
  externalAccountId: string | null;
  externalAccountName: string | null;
  metadata: Record<string, unknown>;
  tokenExpiresAt: string | null;
  healthStatus: string;
  healthCheckedAt: string | null;
  lastSyncAt: string | null;
};

export type StoredProviderTokens = {
  accessToken: string | null;
  refreshToken: string | null;
};

type ProviderConnectionRow = {
  id: string;
  workspace_id: string;
  provider: MonitorProvider;
  status: MonitorProviderStatus;
  scopes: string[] | null;
  external_account_id: string | null;
  external_account_name: string | null;
  metadata_json: Record<string, unknown> | null;
  token_expires_at: string | null;
  health_status: string | null;
  health_checked_at: string | null;
  last_sync_at: string | null;
};

type VaultRow = {
  encrypted_access_token: string | Uint8Array | ArrayBuffer | null;
  encrypted_refresh_token: string | Uint8Array | ArrayBuffer | null;
  token_nonce: string | null;
};

export async function listProviderConnections(
  supabase: SupabaseServerClient,
  workspaceId: string,
): Promise<ProviderConnectionMetadata[]> {
  const { data, error } = await supabase
    .from("provider_connections")
    .select(
      "id, workspace_id, provider, status, scopes, external_account_id, external_account_name, metadata_json, token_expires_at, health_status, health_checked_at, last_sync_at",
    )
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });

  if (error || !data) {
    return [];
  }

  return (data as ProviderConnectionRow[]).map(normalizeProviderConnectionRow);
}

export async function loadStoredProviderTokens(
  serviceSupabase: SupabaseServiceClient,
  connectionId: string,
): Promise<StoredProviderTokens> {
  // The private schema is not exposed through PostgREST; the vault is only
  // reachable through the service-role RPC. Errors must surface: treating a
  // failed read as "no token" silently reports missing_token and degrades
  // every token-dependent flow.
  const { data, error } = await serviceSupabase.rpc("provider_token_vault_get", {
    p_provider_connection_id: connectionId,
  });

  if (error) {
    throw new Error(`provider_token_vault_get failed: ${error.message}`);
  }

  const row = (Array.isArray(data) ? (data[0] ?? null) : data) as VaultRow | null;

  if (!row?.token_nonce) {
    return { accessToken: null, refreshToken: null };
  }

  return {
    accessToken: decryptOptionalToken(row.encrypted_access_token, row.token_nonce),
    refreshToken: decryptOptionalToken(row.encrypted_refresh_token, row.token_nonce),
  };
}

export async function upsertProviderConnectionWithTokens(input: {
  serviceSupabase: SupabaseServiceClient;
  workspaceId: string;
  userId: string;
  provider: MonitorProvider;
  status: "connected" | "needs_attention";
  scopes: string[];
  externalAccountId: string;
  externalAccountName: string;
  accessToken: string;
  refreshToken?: string | null;
  metadata?: Record<string, unknown>;
  tokenExpiresAt?: string | null;
}): Promise<ProviderConnectionMetadata> {
  const encryptedAccessToken = encryptToken(input.accessToken);
  const encryptedRefreshToken = input.refreshToken ? encryptToken(input.refreshToken) : null;
  const { data: connection, error } = await input.serviceSupabase
    .from("provider_connections")
    .upsert(
      {
        workspace_id: input.workspaceId,
        provider: input.provider,
        status: input.status,
        scopes: input.scopes,
        external_account_id: input.externalAccountId,
        external_account_name: input.externalAccountName,
        metadata_json: input.metadata ?? {},
        token_expires_at: input.tokenExpiresAt ?? null,
        health_status: input.status === "connected" ? "healthy" : "unknown",
        health_checked_at: new Date().toISOString(),
        last_sync_at: new Date().toISOString(),
        created_by: input.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,provider,external_account_id" },
    )
    .select(
      "id, workspace_id, provider, status, scopes, external_account_id, external_account_name, metadata_json, token_expires_at, health_status, health_checked_at, last_sync_at",
    )
    .single();

  if (error || !connection) {
    throw new Error(error?.message ?? "Unable to save provider connection.");
  }

  // Rows are keyed on (workspace, provider, external_account_id), so
  // connecting a different account creates a fresh row while older rows for
  // other accounts linger. Exactly one row may stay live per
  // workspace+provider, otherwise the dashboard and settings can pick a stale
  // connection. Demotion is best-effort: the new connection must not fail
  // because cleanup of historical rows did.
  const { error: demoteError } = await input.serviceSupabase
    .from("provider_connections")
    .update({ status: "not_connected" })
    .eq("workspace_id", input.workspaceId)
    .eq("provider", input.provider)
    .neq("id", connection.id)
    .neq("status", "not_connected");

  if (demoteError) {
    console.warn("[provider-connections] failed to demote sibling connection rows:", demoteError.message);
  }

  const { error: vaultError } = await input.serviceSupabase.rpc("provider_token_vault_upsert", {
    p_provider_connection_id: connection.id,
    p_workspace_id: input.workspaceId,
    p_encrypted_access_token: encryptedTokenToPostgresBytea(encryptedAccessToken),
    p_encrypted_refresh_token: encryptedRefreshToken ? encryptedTokenToPostgresBytea(encryptedRefreshToken) : null,
    p_token_nonce: encryptedAccessToken.nonce,
    p_token_last_four: encryptedRefreshToken?.lastFour ?? encryptedAccessToken.lastFour,
  });

  if (vaultError) {
    throw new Error(vaultError.message);
  }

  return normalizeProviderConnectionRow(connection as ProviderConnectionRow);
}

function decryptOptionalToken(value: VaultRow["encrypted_access_token"], nonce: string): string | null {
  const packed = parsePackedEncryptedToken(value);

  if (packed) {
    return decryptToken(packed);
  }

  const ciphertext = postgresByteaToTokenCiphertext(value);

  if (!ciphertext) {
    return null;
  }

  return decryptToken({
    ciphertext,
    nonce,
    lastFour: "",
  });
}

function encryptedTokenToPostgresBytea(token: EncryptedToken): string {
  return `\\x${Buffer.from(JSON.stringify(token), "utf8").toString("hex")}`;
}

function parsePackedEncryptedToken(value: VaultRow["encrypted_access_token"]): EncryptedToken | null {
  if (!value) {
    return null;
  }

  const buffer = typeof value === "string" && value.startsWith("\\x")
    ? Buffer.from(value.slice(2), "hex")
    : typeof value === "string"
      ? Buffer.from(value, "hex")
      : Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value);

  try {
    const parsed = JSON.parse(buffer.toString("utf8")) as EncryptedToken;

    if (parsed.ciphertext && parsed.nonce) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeProviderConnectionRow(row: ProviderConnectionRow): ProviderConnectionMetadata {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    status: row.status,
    scopes: row.scopes ?? [],
    externalAccountId: row.external_account_id,
    externalAccountName: row.external_account_name,
    metadata: row.metadata_json ?? {},
    tokenExpiresAt: row.token_expires_at,
    healthStatus: row.health_status ?? "unknown",
    healthCheckedAt: row.health_checked_at,
    lastSyncAt: row.last_sync_at,
  };
}
