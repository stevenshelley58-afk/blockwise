export type CustomerRestInit = {
  method?: string;
  headers?: HeadersInit;
  body?: string;
  signal?: AbortSignal;
};

export type ResearchRest = (
  schema: string,
  path: string,
  init?: CustomerRestInit,
) => Promise<unknown>;

export type CustomerFetchResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

export type CustomerFetch = (
  url: string,
  init?: CustomerRestInit,
) => Promise<CustomerFetchResponse>;

export type CustomerInterestSource = {
  profile_id?: string | null;
  postcode?: string | null;
  state?: string | null;
  agent_id?: string | null;
  advertiser_page_id?: string | null;
  source?: string | null;
  active?: boolean | null;
  updated_at?: string | null;
  [key: string]: unknown;
};

export type CustomerOwner = {
  profile_id?: string | null;
  workspace_id?: string | null;
  role?: string | null;
  [key: string]: unknown;
};

export type CustomerBrandKit = {
  workspace_id?: string | null;
  contact_json?: unknown;
  market_region?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
};

export type CustomerInterestRow = {
  customer_key: string;
  agent_id: string | null;
  advertiser_page_id: string | null;
  postcode: string | null;
  state: string | null;
  active: boolean;
  last_synced_at: string;
  updated_at: string;
};

export type BuildCustomerInterestRowsInput = {
  sources: readonly CustomerInterestSource[];
  owners: readonly CustomerOwner[];
  brandKits: readonly CustomerBrandKit[];
  assignedPageIds?: ReadonlyMap<string, string>;
  knownAgentIds?: ReadonlySet<string>;
  knownPageIds?: ReadonlySet<string>;
  customerKeySecret: string;
  now: string;
};

export type SyncCustomerAdRadarInterestsInput = {
  researchRest: ResearchRest;
  env?: Record<string, string | undefined>;
  fetchImpl?: CustomerFetch;
  now?: string;
  customerKeySecret?: string;
};

export type SyncCustomerAdRadarInterestsResult = {
  skipped: boolean;
  reason?: string;
  active?: number;
  inactive?: number;
  upserted?: number;
  sourceRows?: number;
};

export function extractContactPostcode(contact: unknown): string | null;
export function customerInterestKey(workspaceId: string, secret: string): string;
export function buildCustomerInterestRows(
  input: BuildCustomerInterestRowsInput,
): CustomerInterestRow[];
export function syncCustomerAdRadarInterests(
  input: SyncCustomerAdRadarInterestsInput,
): Promise<SyncCustomerAdRadarInterestsResult>;
