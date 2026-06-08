import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { createSupabaseServiceClient } from "../supabase/service.ts";

type SignedRequestResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string };

type DeletionRequestRow = {
  meta_user_id: string;
  confirmation_code: string;
  status: "queued" | "in_progress" | "completed" | "failed";
  signed_request_payload: Record<string, unknown>;
  requested_at: string;
  completed_at: string | null;
  notes: string | null;
};

type MetaLeadDeletionRow = {
  workspace_id: string;
  lead_id: string | null;
  meta_lead_id: string;
};

type ProviderConnectionDeletionRow = {
  id: string;
  workspace_id: string;
  metadata_json: Record<string, unknown> | null;
};

export function parseAndVerifySignedRequest(signedRequest: string, appSecret: string): SignedRequestResult {
  const parts = signedRequest.split(".");

  if (parts.length !== 2) {
    return { ok: false, error: "signed_request must contain exactly two parts." };
  }

  const [encodedSignature, encodedPayload] = parts;
  const signature = base64UrlDecodeToBuffer(encodedSignature);
  const expected = createHmac("sha256", appSecret).update(encodedPayload).digest();

  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
    return { ok: false, error: "signed_request signature is invalid." };
  }

  let payload: Record<string, unknown>;

  try {
    payload = JSON.parse(base64UrlDecodeToBuffer(encodedPayload).toString("utf8")) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "signed_request payload is not valid JSON." };
  }

  if (typeof payload.algorithm !== "string" || payload.algorithm.toUpperCase() !== "HMAC-SHA256") {
    return { ok: false, error: "signed_request algorithm must be HMAC-SHA256." };
  }

  return { ok: true, payload };
}

export function buildConfirmationCode(userId: string): string {
  const stamp = Date.now().toString(36);
  const hash = createHash("sha256").update(`${userId}:${stamp}`).digest("hex").slice(0, 12);

  return `bw_${stamp}_${hash}`;
}

export async function recordDeletionRequest(
  metaUserId: string,
  confirmationCode: string,
  payload: Record<string, unknown>,
) {
  const supabase = createSupabaseServiceClient();
  const issuedAt =
    typeof payload.issued_at === "number"
      ? new Date(payload.issued_at * 1000).toISOString()
      : new Date().toISOString();

  const { error } = await supabase
    .from("meta_data_deletion_requests")
    .upsert(
      {
        meta_user_id: metaUserId,
        confirmation_code: confirmationCode,
        status: "queued",
        signed_request_payload: payload,
        issued_at: issuedAt,
        requested_at: new Date().toISOString(),
      },
      { onConflict: "meta_user_id" },
    );

  if (error) {
    throw new Error(error.message);
  }
}

export async function loadDeletionStatus(confirmationCode: string) {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("meta_data_deletion_requests")
    .select("confirmation_code,status,requested_at,completed_at,notes")
    .eq("confirmation_code", confirmationCode)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function processMetaDataDeletionRequest(confirmationCode: string) {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("meta_data_deletion_requests")
    .select("meta_user_id,confirmation_code,status,signed_request_payload,requested_at,completed_at,notes")
    .eq("confirmation_code", confirmationCode)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Meta data deletion request was not found.");
  }

  const request = data as DeletionRequestRow;

  if (request.status === "completed") {
    return { status: "completed" as const, deletedLeads: 0, disconnectedProviderConnections: 0 };
  }

  await supabase
    .from("meta_data_deletion_requests")
    .update({ status: "in_progress", notes: "Processing Meta data deletion request." })
    .eq("confirmation_code", confirmationCode);

  try {
    const metaLeadIds = extractMetaLeadIds(request.signed_request_payload);
    const deletedLeads = metaLeadIds.length > 0 ? await deleteMetaLeadsByExternalIds(supabase, metaLeadIds) : 0;
    const disconnectedProviderConnections = await disconnectProviderConnectionsForMetaUser(
      supabase,
      request.meta_user_id,
    );
    const notes = [
      `Deleted ${deletedLeads} Meta lead record(s).`,
      `Disconnected ${disconnectedProviderConnections} provider connection(s).`,
      metaLeadIds.length === 0
        ? "Signed request did not include explicit Meta lead IDs, so no lead deletion was inferred from app-scoped user ID alone."
        : null,
    ]
      .filter(Boolean)
      .join(" ");

    await supabase
      .from("meta_data_deletion_requests")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        notes,
      })
      .eq("confirmation_code", confirmationCode);

    return { status: "completed" as const, deletedLeads, disconnectedProviderConnections };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meta data deletion processing failed.";

    await supabase
      .from("meta_data_deletion_requests")
      .update({ status: "failed", notes: message })
      .eq("confirmation_code", confirmationCode);

    throw error;
  }
}

function base64UrlDecodeToBuffer(value: string): Buffer {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const standard = padded.replace(/-/g, "+").replace(/_/g, "/");

  return Buffer.from(standard, "base64");
}

function extractMetaLeadIds(payload: Record<string, unknown>) {
  const values = [
    payload.lead_id,
    payload.meta_lead_id,
    ...(Array.isArray(payload.lead_ids) ? payload.lead_ids : []),
    ...(Array.isArray(payload.meta_lead_ids) ? payload.meta_lead_ids : []),
  ];

  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0)));
}

async function deleteMetaLeadsByExternalIds(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  metaLeadIds: string[],
) {
  const { data, error } = await supabase
    .from("meta_leads")
    .select("workspace_id,lead_id,meta_lead_id")
    .in("meta_lead_id", metaLeadIds);

  if (error) {
    throw new Error(error.message);
  }

  const matches = (data ?? []) as MetaLeadDeletionRow[];
  const leadIds = Array.from(new Set(matches.map((row) => row.lead_id).filter((id): id is string => Boolean(id))));

  if (leadIds.length > 0) {
    const { error: leadDeleteError } = await supabase.from("leads").delete().in("id", leadIds);

    if (leadDeleteError) {
      throw new Error(leadDeleteError.message);
    }
  }

  const orphanMetaLeadIds = matches.filter((row) => !row.lead_id).map((row) => row.meta_lead_id);

  if (orphanMetaLeadIds.length > 0) {
    const { error: metaLeadDeleteError } = await supabase
      .from("meta_leads")
      .delete()
      .in("meta_lead_id", orphanMetaLeadIds);

    if (metaLeadDeleteError) {
      throw new Error(metaLeadDeleteError.message);
    }
  }

  return matches.length;
}

async function disconnectProviderConnectionsForMetaUser(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  metaUserId: string,
) {
  const { data, error } = await supabase
    .from("provider_connections")
    .select("id,workspace_id,metadata_json")
    .eq("provider", "meta");

  if (error) {
    throw new Error(error.message);
  }

  const matches = ((data ?? []) as ProviderConnectionDeletionRow[]).filter((connection) =>
    metadataMatchesMetaUserId(connection.metadata_json ?? {}, metaUserId),
  );
  const processedAt = new Date().toISOString();

  await Promise.all(
    matches.map(async (connection) => {
      await supabase
        .schema("private")
        .from("provider_token_vault")
        .update({
          encrypted_access_token: null,
          encrypted_refresh_token: null,
          token_nonce: null,
          token_last_four: null,
          updated_at: processedAt,
        })
        .eq("provider_connection_id", connection.id);

      return supabase
        .from("provider_connections")
        .update({
          encrypted_access_token: null,
          encrypted_refresh_token: null,
          token_nonce: null,
          token_last_four: null,
          token_expires_at: null,
          status: "not_connected",
          health_status: "revoked_by_meta_data_deletion",
          health_checked_at: processedAt,
          updated_at: processedAt,
          metadata_json: {
            ...(connection.metadata_json ?? {}),
            dataDeletion: {
              requestedByMetaUserId: metaUserId,
              processedAt,
            },
          },
        })
        .eq("id", connection.id);
    }),
  );

  return matches.length;
}

function metadataMatchesMetaUserId(metadata: Record<string, unknown>, metaUserId: string): boolean {
  const meta = typeof metadata.meta === "object" && metadata.meta !== null ? metadata.meta as Record<string, unknown> : {};
  const candidateKeys = ["metaUserId", "userId", "user_id", "appScopedUserId", "app_scoped_user_id"];

  return candidateKeys.some((key) => metadata[key] === metaUserId || meta[key] === metaUserId);
}
