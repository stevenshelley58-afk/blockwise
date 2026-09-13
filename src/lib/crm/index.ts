/**
 * Server-only entry point for the CRM adapter.
 *
 * Workspace scope is resolved from the caller's own workspace id and the
 * provisioned site mapping; it is never taken from a request body. The
 * credential is resolved from that same workspace id, so the site a request
 * reaches and the credential it carries can never disagree.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { createCrmClient, type CrmClient, type CrmTransportOptions } from "./client.ts";
import { createCrmCommands, type CrmCommands } from "./commands.ts";
import { readCrmConfig } from "./config.ts";
import {
  CrmCredentialMissingError,
  loadCrmSiteCredential,
  type CrmSiteCredential,
} from "./credentials.ts";
import { requireCrmSite, type CrmSiteMapping } from "./site-resolution.ts";

export type WorkspaceCrmOptions = {
  /** Caller-scoped client. Used for the mapping read, which members may see. */
  supabase: SupabaseClient;
  workspaceId: string;
  /**
   * Service-role client, required to read the encrypted vault. No browser role
   * can reach the vault, so a caller-scoped `supabase` must be paired with an
   * explicit `serviceSupabase`. Defaults to `supabase` for callers that already
   * hold a service client.
   */
  serviceSupabase?: SupabaseClient;
  /**
   * Explicit credential. For tests and provisioning probes only; normal
   * request paths must resolve the credential from the vault.
   */
  credential?: CrmSiteCredential;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  sleep?: CrmTransportOptions["sleep"];
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type WorkspaceCrm = {
  mapping: CrmSiteMapping;
  client: CrmClient;
  commands: CrmCommands;
};

export async function createWorkspaceCrm(options: WorkspaceCrmOptions): Promise<WorkspaceCrm> {
  const mapping = await requireCrmSite(options.supabase, options.workspaceId);

  const credential =
    options.credential ??
    (await loadCrmSiteCredential(options.serviceSupabase ?? options.supabase, options.workspaceId));

  if (!credential) {
    throw new CrmCredentialMissingError(options.workspaceId);
  }

  const config = readCrmConfig(options.env ?? process.env);
  const client = createCrmClient({
    config,
    site: mapping.crmSite,
    credential,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    maxAttempts: options.maxAttempts,
    retryDelayMs: options.retryDelayMs,
  });

  return { mapping, client, commands: createCrmCommands(client, options.workspaceId) };
}

export { createCrmClient } from "./client.ts";
export type { CrmClient, CrmCallLog, CrmTransportOptions } from "./client.ts";
export { createCrmCommands } from "./commands.ts";
export type { CrmCommands, CaptureEnquiryInput, ListLeadsInput, ListTasksInput, CrmActor } from "./commands.ts";
export { readCrmConfig, DEFAULT_CRM_BASE_URL } from "./config.ts";
export type { CrmConfig } from "./config.ts";
export {
  CRM_CREDENTIAL_LANE,
  CrmCredentialMissingError,
  clearCrmSiteCredential,
  loadCrmSiteCredential,
  upsertCrmSiteCredential,
} from "./credentials.ts";
export type { CrmSiteCredential } from "./credentials.ts";
export {
  CrmError,
  CrmConfigurationError,
  CRM_ERROR_CODES,
  CRM_ERROR_STATUS,
  isCrmConflict,
  isCrmError,
  isCrmUnavailable,
  mapFrappeError,
} from "./errors.ts";
export type { CrmErrorCode } from "./errors.ts";
export {
  CRM_SITE_SUFFIX,
  CRM_SITE_TABLE,
  CrmSiteNotProvisionedError,
  crmSiteForSlug,
  isValidCrmSite,
  requireCrmSite,
  resolveCrmSite,
} from "./site-resolution.ts";
export type { CrmSiteMapping, CrmSiteStatus } from "./site-resolution.ts";
export * from "./types.ts";
