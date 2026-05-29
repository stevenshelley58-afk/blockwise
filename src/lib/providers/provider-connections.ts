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
    .eq("workspace_id", workspaceId);

  if (error || !data) {
    return [];
  }

  return (data as ProviderConnectionRow[]).map(normalizeProviderConnectionRow);
}

export async function loadStoredProviderTokens(
  serviceSupabase: SupabaseServiceClient,
  connectionId: string,
): Promise<StoredProviderTokens> {
  const { data } = await serviceSupabase
    .schema("private")
    .from("provider_token_vault")
    .select("encrypted_access_token, encrypted_refresh_token, token_nonce")
    .eq("provider_connection_id", connectionId)
    .maybeSingle();

  const row = data as VaultRow | null;

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

  const { error: vaultError } = await input.serviceSupabase.schema("private").from("provider_token_vault").upsert(
    {
      provider_connection_id: connection.id,
      workspace_id: input.workspaceId,
      encrypted_access_token: encryptedTokenToPostgresBytea(encryptedAccessToken),
      encrypted_refresh_token: encryptedRefreshToken ? encryptedTokenToPostgresBytea(encryptedRefreshToken) : null,
      token_nonce: encryptedAccessToken.nonce,
      token_last_four: encryptedRefreshToken?.lastFour ?? encryptedAccessToken.lastFour,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider_connection_id" },
  );

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
