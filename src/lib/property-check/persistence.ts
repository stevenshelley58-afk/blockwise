import type { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  type PropertyCheckClientSituation,
  type PropertyCheckEngineStatus,
  type PropertyCheckRecord,
  type PropertyCheckResult,
  type PropertyCheckStatus,
} from "./types.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type PropertyCheckRow = {
  id: string;
  workspace_id: string;
  created_by: string | null;
  address: string;
  client_situation: PropertyCheckClientSituation;
  status: PropertyCheckStatus;
  normalized_facts: unknown;
  signals: unknown;
  likely_constraints: unknown;
  talking_points: unknown;
  citations: unknown;
  disclaimer: string;
  engine_request_id: string | null;
  engine_status: PropertyCheckEngineStatus;
  created_at: string;
  updated_at: string;
};

const PROPERTY_CHECK_SELECT =
  "id,workspace_id,created_by,address,client_situation,status,normalized_facts,signals,likely_constraints,talking_points,citations,disclaimer,engine_request_id,engine_status,created_at,updated_at";

export async function listPropertyChecks(supabase: SupabaseServerClient, workspaceId: string): Promise<PropertyCheckRecord[]> {
  const { data, error } = await supabase
    .from("property_checks")
    .select(PROPERTY_CHECK_SELECT)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) {
    throw error;
  }

  return ((data ?? []) as PropertyCheckRow[]).map(rowToPropertyCheckRecord);
}

export async function createPropertyCheckRecord(
  supabase: SupabaseServerClient,
  input: {
    workspaceId: string;
    userId: string;
    address: string;
    clientSituation: PropertyCheckClientSituation;
    result: PropertyCheckResult;
  },
): Promise<PropertyCheckRecord> {
  const { data, error } = await supabase
    .from("property_checks")
    .insert({
      workspace_id: input.workspaceId,
      created_by: input.userId,
      address: input.address,
      client_situation: input.clientSituation,
      status: input.result.status,
      normalized_facts: input.result.normalizedFacts,
      signals: input.result.signals,
      likely_constraints: input.result.likelyConstraints,
      talking_points: input.result.talkingPoints,
      citations: input.result.citations,
      disclaimer: input.result.disclaimer,
      engine_request_id: input.result.engineRequestId ?? null,
      engine_status: input.result.engineStatus,
    })
    .select(PROPERTY_CHECK_SELECT)
    .single();

  if (error) {
    throw error;
  }

  return rowToPropertyCheckRecord(data as PropertyCheckRow);
}

function rowToPropertyCheckRecord(row: PropertyCheckRow): PropertyCheckRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    createdBy: row.created_by,
    address: row.address,
    clientSituation: row.client_situation,
    status: row.status,
    normalizedFacts: objectValue(row.normalized_facts),
    signals: arrayValue(row.signals),
    likelyConstraints: arrayValue(row.likely_constraints),
    talkingPoints: arrayValue(row.talking_points),
    citations: arrayValue(row.citations),
    disclaimer: row.disclaimer,
    engineRequestId: row.engine_request_id,
    engineStatus: row.engine_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function arrayValue<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
