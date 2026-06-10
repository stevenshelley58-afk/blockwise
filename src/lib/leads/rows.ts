import { buildLeadDedupeKey, findDuplicateLeadIds } from "./dedupe.ts";
import type { createSupabaseServerClient } from "../supabase/server.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type LeadRow = {
  id: string;
  workspace_id?: string | null;
  full_name?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  suburb?: string | null;
  provider?: string | null;
  created_at?: string | null;
  workspaces?: { name?: string | null } | Array<{ name?: string | null }> | null;
};

type LeadLabelRow = {
  lead_id?: string | null;
  label?: string | null;
};

type LeadAttributionRow = {
  lead_id?: string | null;
  source?: Record<string, unknown> | null;
};

type LeadDedupeRow = {
  lead_id?: string | null;
  duplicate_of_lead_id?: string | null;
};

export function leadSourceLabel(provider: LeadRow["provider"]) {
  if (provider === "meta") return "Meta lead form";
  if (provider === "google") return "Google lead form";
  return "Manual import";
}

export function buildLeadRowsWithDedupe(input: {
  leads: LeadRow[];
  labels?: LeadLabelRow[];
  attributions?: LeadAttributionRow[];
  dedupeRecords?: LeadDedupeRow[];
  incoming?: { email?: string; phone?: string };
}) {
  const labelByLead = new Map((input.labels ?? []).map((label) => [label.lead_id, label.label]));
  const attributionByLead = new Map((input.attributions ?? []).map((attribution) => [attribution.lead_id, attribution.source]));
  const duplicateLeadIds = new Set(
    (input.dedupeRecords ?? [])
      .filter((record) => record.duplicate_of_lead_id)
      .map((record) => record.lead_id)
      .filter((leadId): leadId is string => Boolean(leadId)),
  );
  const rows = input.leads.map((lead) => {
    const source = leadSourceLabel(lead.provider);
    const attribution = attributionByLead.get(lead.id);

    return {
      id: lead.id,
      name: lead.full_name ?? lead.name ?? "Unknown lead",
      email: lead.email ?? "",
      phone: lead.phone ?? "",
      suburb: lead.suburb ?? "Unknown",
      source,
      quality: labelByLead.get(lead.id) ?? "Unlabelled",
      createdAt: lead.created_at ?? new Date(0).toISOString(),
      dedupeKey: buildLeadDedupeKey({ email: lead.email ?? "", phone: lead.phone ?? "" }),
      duplicateCandidate: duplicateLeadIds.has(lead.id),
      attribution: extractAttributionLabel(attribution),
    };
  });
  const incoming = input.incoming ?? {};
  const incomingDedupeKey = buildLeadDedupeKey(incoming);

  return {
    rows,
    incoming: {
      ...incoming,
      dedupeKey: incomingDedupeKey,
      duplicateIds: incomingDedupeKey ? findDuplicateLeadIds(rows, incoming) : [],
    },
  };
}

export async function listLeadRowsWithDedupe(supabase: SupabaseServerClient, workspaceId: string) {
  const { data: leads } = await supabase
    .from("leads")
    .select("id,full_name,email,phone,suburb,provider,created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  const leadIds = ((leads ?? []) as LeadRow[]).map((lead) => lead.id);

  if (leadIds.length === 0) {
    return buildLeadRowsWithDedupe({ leads: [] });
  }

  const [{ data: labels }, { data: attributions }, { data: dedupeRecords }] = await Promise.all([
    supabase.from("lead_quality_labels").select("lead_id,label").eq("workspace_id", workspaceId).in("lead_id", leadIds),
    supabase.from("lead_source_attribution").select("lead_id,source").eq("workspace_id", workspaceId).in("lead_id", leadIds),
    supabase.from("lead_dedupe_records").select("lead_id,duplicate_of_lead_id").eq("workspace_id", workspaceId).in("lead_id", leadIds),
  ]);

  return buildLeadRowsWithDedupe({
    leads: (leads ?? []) as LeadRow[],
    labels: (labels ?? []) as LeadLabelRow[],
    attributions: (attributions ?? []) as LeadAttributionRow[],
    dedupeRecords: (dedupeRecords ?? []) as LeadDedupeRow[],
  });
}

function extractAttributionLabel(source: Record<string, unknown> | null | undefined): string {
  return String(source?.campaignName ?? source?.campaign_name ?? source?.utm_campaign ?? "Direct");
}
