export const OWNER_CRM_LEAD_INTAKE_INTERNAL_SCOPE = "owner-crm.lead-intake";
export const OWNER_CRM_LEAD_INTAKE_DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DemoRequestRow = {
  id: string; created_at: string; name: string; agency: string; email: string; phone: string | null;
  suburb: string | null; message: string | null; source: "landing" | "audit-pdf";
};

type DemoRequestQuery = {
  select(columns: string): DemoRequestQuery;
  in(column: string, values: string[]): DemoRequestQuery;
  gt(column: string, value: string): DemoRequestQuery;
  order(column: string, options: { ascending: boolean }): DemoRequestQuery;
  limit(value: number): Promise<{ data: DemoRequestRow[] | null; error: unknown }>;
};

type ServiceClient = { from(table: "demo_requests"): DemoRequestQuery };

export type OwnerLeadIntakePageRequest = { afterId: string | null; limit: number };

export function parseOwnerLeadIntakePageRequest(params: URLSearchParams): OwnerLeadIntakePageRequest {
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? OWNER_CRM_LEAD_INTAKE_DEFAULT_PAGE_SIZE : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw new Error("invalid_page_limit");
  const afterId = params.get("afterId");
  if (afterId !== null && !UUID.test(afterId)) throw new Error("invalid_page_cursor");
  return { afterId, limit };
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function mapOwnerLeadIntakeRow(row: DemoRequestRow) {
  if (!UUID.test(row.id) || typeof row.created_at !== "string" || !row.created_at) throw new Error("invalid_demo_request_row");
  if (row.source !== "landing" && row.source !== "audit-pdf") throw new Error("invalid_demo_request_source");
  return {
    sourceKey: `blockwise_demo_request:${row.id}`,
    sourceKind: row.source === "audit-pdf" ? "audit_request" : "demo_request",
    sourceEventId: row.id,
    receivedAt: row.created_at,
    lead: {
      name: row.name, email: row.email, phone: optionalText(row.phone), agency: optionalText(row.agency),
      suburb: optionalText(row.suburb), message: optionalText(row.message),
    },
  };
}

/** Read-only, bounded projection for native CRM Lead intake. It never joins users or contacts by email. */
export async function readOwnerLeadIntakePage(client: ServiceClient, page: OwnerLeadIntakePageRequest) {
  let query = client.from("demo_requests")
    .select("id,created_at,name,agency,email,phone,suburb,message,source")
    .in("source", ["landing", "audit-pdf"])
    .order("id", { ascending: true });
  if (page.afterId) query = query.gt("id", page.afterId);
  const { data, error } = await query.limit(page.limit);
  if (error) throw new Error("owner_lead_intake_query_failed");
  const rows = data ?? [];
  return {
    items: rows.map(mapOwnerLeadIntakeRow),
    nextAfterId: rows.length === page.limit ? rows.at(-1)?.id ?? null : null,
  };
}