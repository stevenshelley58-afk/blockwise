import { buildLeadDedupeKey, findDuplicateLeadIds } from "../leads/dedupe.ts";
import type { MetaLeadDestination } from "./meta-execution.ts";
import { DEFAULT_META_GRAPH_VERSION } from "./meta-graph-version.ts";

export type RawMetaLead = {
  id: string;
  created_time?: string;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  form_id?: string;
  field_data?: Array<{ name: string; values?: string[] }>;
};

export type NormalizedMetaLead = {
  externalId: string;
  createdTime: string | null;
  adId: string | null;
  adSetId: string | null;
  campaignId: string | null;
  formId: string | null;
  email: string | null;
  phone: string | null;
  fullName: string | null;
  suburb: string | null;
  rawPayload: RawMetaLead;
};

export type LeadDeliveryAction = {
  type: MetaLeadDestination["type"];
  destination: string;
  endpoint?: string;
  requiresApproval: boolean;
};

export type MetaLeadRepository = {
  listExistingLeads(workspaceId: string): Promise<Array<{ id: string; email: string | null; phone: string | null }>>;
  upsertLead(input: {
    workspaceId: string;
    lead: NormalizedMetaLead;
    duplicateOfLeadId: string | null;
  }): Promise<{ leadId: string; inserted: boolean }>;
  recordDeliveryAttempt(input: {
    workspaceId: string;
    leadId: string;
    action: LeadDeliveryAction;
    status: "queued" | "delivered" | "failed" | "manual_review";
    response?: Record<string, unknown>;
  }): Promise<void>;
};

export function normalizeMetaLead(raw: RawMetaLead): NormalizedMetaLead {
  const fields = new Map((raw.field_data ?? []).map((field) => [normalizeFieldName(field.name), field.values?.[0]?.trim() ?? ""]));

  return {
    externalId: raw.id,
    createdTime: raw.created_time ?? null,
    adId: raw.ad_id ?? null,
    adSetId: raw.adset_id ?? null,
    campaignId: raw.campaign_id ?? null,
    formId: raw.form_id ?? null,
    email: normalizeEmail(firstField(fields, ["email", "email_address"])),
    phone: firstField(fields, ["phone", "phone_number", "mobile", "mobile_number"]),
    fullName: firstField(fields, ["full_name", "name", "first_name"]) ?? null,
    suburb: firstField(fields, ["suburb", "postcode", "zip", "area"]) ?? null,
    rawPayload: raw,
  };
}

export async function fetchMetaLeadFormLeads(input: {
  accessToken: string;
  formIds: string[];
  since?: string | null;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
}): Promise<NormalizedMetaLead[]> {
  const groups = await Promise.all(
    input.formIds.map(async (formId) => {
      const leads = await fetchMetaLeadList(input, formId);

      return leads.map((lead) => normalizeMetaLead({ ...lead, form_id: lead.form_id ?? formId }));
    }),
  );

  return groups.flat();
}

export function buildLeadDeliveryActions(lead: NormalizedMetaLead, destination: MetaLeadDestination): LeadDeliveryAction[] {
  void lead;

  if (destination.type === "manual") {
    return [{ type: "manual", destination: destination.label, requiresApproval: false }];
  }

  const endpoint = typeof destination.config?.endpoint === "string" ? destination.config.endpoint : undefined;

  return [
    {
      type: destination.type,
      destination: destination.label,
      ...(endpoint ? { endpoint } : {}),
      requiresApproval: true,
    },
  ];
}

export async function syncMetaLeads(input: {
  workspaceId: string;
  accessToken: string;
  formIds: string[];
  leadDestination: MetaLeadDestination;
  repository: MetaLeadRepository;
  since?: string | null;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
}) {
  const [existingLeads, incomingLeads] = await Promise.all([
    input.repository.listExistingLeads(input.workspaceId),
    fetchMetaLeadFormLeads(input),
  ]);
  let inserted = 0;
  let duplicate = 0;

  for (const lead of incomingLeads) {
    const duplicateIds = findDuplicateLeadIds(existingLeads, {
      email: lead.email,
      phone: lead.phone,
    });
    const duplicateOfLeadId = duplicateIds[0] ?? null;
    const result = await input.repository.upsertLead({
      workspaceId: input.workspaceId,
      lead,
      duplicateOfLeadId,
    });

    if (result.inserted) {
      inserted += 1;
      existingLeads.push({ id: result.leadId, email: lead.email, phone: lead.phone });
    }

    if (duplicateOfLeadId) duplicate += 1;

    if (result.inserted) {
      for (const action of buildLeadDeliveryActions(lead, input.leadDestination)) {
        await input.repository.recordDeliveryAttempt({
          workspaceId: input.workspaceId,
          leadId: result.leadId,
          action,
          status: action.type === "manual" ? "manual_review" : "queued",
          response: {
            dedupeKey: buildLeadDedupeKey({ email: lead.email, phone: lead.phone }),
            duplicateOfLeadId,
          },
        });
      }
    }
  }

  return {
    fetched: incomingLeads.length,
    inserted,
    duplicate,
  };
}

async function fetchMetaLeadList(
  input: {
    accessToken: string;
    since?: string | null;
    graphVersion?: string;
    fetchImpl?: typeof fetch;
  },
  formId: string,
): Promise<RawMetaLead[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = new URL(`https://graph.facebook.com/${input.graphVersion ?? DEFAULT_META_GRAPH_VERSION}/${formId}/leads`);
  url.searchParams.set("fields", "id,created_time,ad_id,adset_id,campaign_id,form_id,field_data");
  url.searchParams.set("limit", "100");
  url.searchParams.set("access_token", input.accessToken);

  if (input.since) {
    const sinceMs = Date.parse(input.since);
    if (!Number.isFinite(sinceMs)) throw new Error("Meta lead sync received an invalid since timestamp.");
    url.searchParams.set(
      "filtering",
      JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: Math.floor(sinceMs / 1000) }]),
    );
  }

  const leads: RawMetaLead[] = [];
  let nextUrl: string | null = url.toString();
  for (let page = 0; nextUrl && page < 100; page += 1) {
    const requestUrl = new URL(nextUrl);
    if (requestUrl.protocol !== "https:" || requestUrl.hostname !== "graph.facebook.com") {
      throw new Error("Meta returned an invalid lead pagination URL.");
    }
    const response = await fetchImpl(requestUrl.toString(), { method: "GET" });
    const payload = (await response.json().catch(() => ({}))) as {
      data?: RawMetaLead[];
      error?: { message?: string };
      paging?: { next?: string };
    };

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `Meta lead fetch failed with ${response.status}.`);
    }

    leads.push(...(payload.data ?? []));
    nextUrl = payload.paging?.next ?? null;
  }

  if (nextUrl) throw new Error("Meta lead pagination exceeded 100 pages.");
  return leads;
}

function normalizeFieldName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function firstField(fields: Map<string, string>, names: string[]): string | null {
  for (const name of names) {
    const value = fields.get(name);

    if (value) return value;
  }

  return null;
}

function normalizeEmail(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();

  return normalized || null;
}
